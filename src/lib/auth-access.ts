// Règle d'accès à l'app GoMytho.
//
// Faille corrigée le 2026-05-02 : Google OAuth crée automatiquement un
// compte Supabase pour n'importe quel email Google. Sans vérification
// post-login, ces comptes accédaient à l'app sans avoir payé. Le trigger
// SQL `on_auth_user_created` crée la ligne dans `public.users` avec
// `plan: 'free'` / `credits: 0` — donc on a une source de vérité fiable
// côté DB, et `hasPaidGoMythoAccess` retourne false pour ces comptes.
//
// Refonte 2026-05-05 : flux d'inscription AVANT paiement + utilisation
// de `client_reference_id` côté Stripe. Le webhook lie toujours par
// user.id, donc plus besoin de fallbacks complexes (resolve-by-stripe,
// claim-by-email, pending-links côté client). Si la DB ne montre pas
// d'abo, c'est qu'il n'y en a pas (ou que le webhook est en retard de
// quelques secondes — géré par AppLayout via polling).

import { supabase } from '@/lib/supabase'

export type UserAccessProfile = {
  plan?: string | null
  subscription_status?: string | null
  credits_remaining?: number | null
  stripe_customer_id?: string | null
  stripe_payment_email?: string | null
  email?: string | null
} | null

/**
 * True si l'utilisateur a un abonnement payant ou des crédits restants.
 * Utilisé sur /choixoffre pour ne pas demander à un client payant de
 * repasser à la caisse, et sur les pages de login pour bloquer les
 * comptes non payants.
 *
 * Important : on ne considère PAS le simple fait d'avoir un
 * `stripe_customer_id` comme une preuve d'accès payant. Un Customer
 * Stripe persiste après refund / cancel / abandon de paiement, et un
 * vieux test peut laisser une référence orpheline en DB. La preuve
 * fiable, c'est :
 *   - des crédits > 0 (l'abo a été payé et le quota n'est pas épuisé)
 *   OU
 *   - un plan weekly/monthly avec un statut qui donne droit à l'accès
 *     (active, trialing, cancelled — cancelled = annulé mais accès
 *     conservé jusqu'à la fin de la période payée).
 */
export function hasPaidGoMythoAccess(profile: UserAccessProfile): boolean {
  if (!profile) return false

  const credits = profile.credits_remaining ?? 0
  if (credits > 0) return true

  const plan = profile.plan
  const status = profile.subscription_status

  if (plan === 'weekly' || plan === 'monthly') {
    if (status === 'active' || status === 'trialing' || status === 'cancelled') {
      return true
    }
  }

  return false
}

/**
 * Lit le profil DB d'un utilisateur par son user.id Supabase.
 * Renvoie null en cas d'erreur ou de profil absent.
 */
export async function fetchAccessProfile(userId: string): Promise<UserAccessProfile> {
  try {
    const { data } = await supabase
      .from('users')
      .select(
        'plan, subscription_status, credits_remaining, stripe_customer_id, stripe_payment_email, email',
      )
      .eq('id', userId)
      .maybeSingle()
    return (data as UserAccessProfile) ?? null
  } catch {
    return null
  }
}

/**
 * Bypass autorisé de la vérif d'accès payant.
 *
 * Cas couverts :
 * - L'utilisateur revient juste du flux Stripe (`?session_id=`) → le
 *   webhook peut ne pas avoir fini, on lui laisse le bénéfice du doute,
 *   AppLayout fait du polling pour attendre le webhook.
 * - Un plan en attente est posé dans localStorage (`gomytho_pending_plan`)
 *   → le paiement a abouti côté Stripe mais n'est pas encore reflété
 *   dans la DB.
 */
export function shouldBypassAccessCheck(searchParams?: URLSearchParams): boolean {
  if (searchParams && searchParams.get('session_id')) return true
  try {
    const p = localStorage.getItem('gomytho_pending_plan')
    if (p === 'weekly' || p === 'monthly') return true
  } catch { /* ignore */ }
  return false
}

/**
 * Clé sessionStorage utilisée pour transmettre un message d'erreur
 * d'accès depuis AuthCallback (Google OAuth refusé) jusqu'à la page de
 * destination (`/choixoffre` ou `/login`).
 */
export const NO_SUBSCRIPTION_FLAG_KEY = 'gomytho_no_subscription_msg'

/**
 * Résultat d'une tentative de claim « j'ai payé avec un autre email ».
 */
export type ClaimSubscriptionResult =
  | {
      ok: true
      plan: 'weekly' | 'monthly'
      credits: number
      subscription_status: 'active' | 'trialing' | 'cancelled' | 'inactive'
      customerId: string
      paymentEmail: string | null
    }
  | {
      ok: false
      reason:
        | 'no_customer'
        | 'no_active_sub'
        | 'already_linked'
        | 'already_linked_metadata'
        | 'invalid_email'
        | 'unauthorized'
        | 'server_error'
        | 'network_error'
      error: string
    }

/**
 * Demande au serveur de lier le Customer Stripe d'un email donné au compte
 * Supabase actuellement authentifié. Sert à récupérer un abonnement payé
 * sous l'ancien flux (paiement avant création de compte) ou avec un email
 * différent (Apple Pay, alias).
 *
 * Côté serveur (`/api/stripe-verify` avec action=claim) :
 *  1. Vérifie le Bearer token Supabase (user authentifié requis).
 *  2. Cherche le Customer Stripe par email + un abo actif/trialing.
 *  3. Refuse si déjà lié à un autre user Supabase (anti-hijack).
 *  4. Sync public.users avec plan/credits/customer_id.
 *  5. Met à jour la metadata du Customer Stripe (verrou de liaison).
 */
export async function claimSubscriptionByPaymentEmail(
  accessToken: string,
  paymentEmail: string,
): Promise<ClaimSubscriptionResult> {
  if (!accessToken) {
    return { ok: false, reason: 'unauthorized', error: 'Connexion requise.' }
  }
  const email = (paymentEmail || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: 'invalid_email', error: 'Email invalide.' }
  }
  try {
    const res = await fetch('/api/stripe-verify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'claim', email }),
    })
    const data = (await res.json().catch(() => null)) as
      | ClaimSubscriptionResult
      | { ok?: unknown; reason?: string; error?: string }
      | null
    if (!data) {
      return { ok: false, reason: 'server_error', error: 'Réponse serveur invalide.' }
    }
    if ((data as { ok: boolean }).ok === true) {
      return data as Extract<ClaimSubscriptionResult, { ok: true }>
    }
    const reason =
      typeof (data as { reason?: string }).reason === 'string'
        ? (data as { reason: string }).reason
        : 'server_error'
    const error =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : 'Liaison impossible.'
    return {
      ok: false,
      reason: reason as Extract<ClaimSubscriptionResult, { ok: false }>['reason'],
      error,
    }
  } catch (e) {
    console.warn('[auth-access] claimSubscriptionByPaymentEmail a échoué :', e)
    return { ok: false, reason: 'network_error', error: 'Connexion impossible.' }
  }
}
