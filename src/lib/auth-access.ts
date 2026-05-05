// Règle d'accès à l'app GoMytho.
//
// Faille corrigée le 2026-05-02 : Google OAuth crée automatiquement un
// compte Supabase pour n'importe quel email Google. Sans vérification
// post-login, ces comptes accédaient à l'app sans avoir payé. Le trigger
// SQL `on_auth_user_created` crée la ligne dans `public.users` avec
// `plan: 'free'` / `credits: 0` — donc on a une source de vérité fiable
// côté DB, et `hasPaidGoMythoAccess` retourne false pour ces comptes.

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
 */
export function hasPaidGoMythoAccess(profile: UserAccessProfile): boolean {
  if (!profile) return false

  const credits = profile.credits_remaining ?? 0
  if (credits > 0) return true

  if (profile.stripe_customer_id) return true

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
 *   AppLayout fera l'upsert avec ses vraies données.
 * - L'utilisateur est dans le parcours `/signup` post-paiement
 *   (`gomytho_signup_flow` posé dans sessionStorage) → idem.
 * - Un plan en attente est posé dans localStorage (`gomytho_pending_plan`)
 *   → le paiement a abouti côté Stripe mais n'est pas encore reflété
 *   dans la DB.
 */
export function shouldBypassAccessCheck(searchParams?: URLSearchParams): boolean {
  if (searchParams && searchParams.get('session_id')) return true
  try {
    if (sessionStorage.getItem('gomytho_signup_flow') === '1') return true
  } catch { /* ignore */ }
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
 * Réponse normalisée de l'API `/api/stripe-resolve-access`.
 * - `ok: true`  → un Customer Stripe avec abonnement actif/trialing a été
 *                 trouvé (et la DB Supabase a été synchronisée).
 * - `ok: false` → on a regardé chez Stripe et on n'a rien trouvé.
 */
export type StripeAccessResolution =
  | {
      ok: true
      plan: 'weekly' | 'monthly'
      credits: number
      subscription_status: 'active' | 'trialing' | 'cancelled' | 'inactive'
      customerId: string
      paymentEmail: string | null
      // 'session_id_link'    = liaison forcée via le session_id Stripe (utile
      //                        quand l'email Stripe ≠ email Supabase).
      // 'pending_link_match' = match dans stripe_pending_links (table peuplée
      //                        par le webhook, survit cross-device + clear
      //                        localStorage).
      // 'stripe_active'      = match par customer_id ou email candidat sur l'API
      //                        Stripe directement.
      reason: 'stripe_active' | 'session_id_link' | 'pending_link_match'
    }
  | {
      ok: false
      reason:
        | 'no_stripe_customer'
        | 'no_active_subscription'
        | 'unauthorized'
        | 'server_error'
        | 'network_error'
    }

/**
 * Lit un session_id Stripe « pending » dans localStorage, posé par
 * /paiementreussi pour survivre aux fermetures de fenêtre, OAuth roundtrips
 * ou pertes de query string. Format strict cs_(live|test)_*.
 */
export function readPendingStripeSessionId(): string | null {
  try {
    const raw = localStorage.getItem('gomytho_pending_session_id')
    if (!raw) return null
    const trimmed = raw.trim()
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(trimmed)) return null
    return trimmed
  } catch {
    return null
  }
}

/**
 * Retire le session_id pending du localStorage. À appeler après une
 * liaison réussie pour éviter de re-tenter la même session indéfiniment.
 */
export function clearPendingStripeSessionId() {
  try {
    localStorage.removeItem('gomytho_pending_session_id')
  } catch { /* ignore */ }
}

/**
 * Filet de sécurité côté Stripe quand la table `users` Supabase ne confirme
 * pas un accès payant.
 *
 * À appeler AVANT d'éjecter un utilisateur authentifié vers /login : si la
 * vérification DB retourne `false`, on demande au serveur de regarder
 * directement chez Stripe.
 *
 * Stratégie côté API :
 *   1. Si `sessionId` fourni → liaison FORCÉE Customer Stripe ↔ user
 *      Supabase courant. Indépendant de tout match d'email.
 *      → Cas Apple Pay / Google Pay / Revolut Pay / alias (Stripe email
 *        ≠ Supabase email) : ce chemin couvre TOUS les moyens de paiement.
 *   2. Sinon → recherche par `stripe_customer_id`, `stripe_payment_email`,
 *      email du compte, scan des subscriptions.
 *
 * Si la fonction renvoie `{ ok: true, ... }`, le serveur a aussi
 * synchronisé la DB Supabase avec le bon plan, status et customer_id —
 * la prochaine lecture DB sera donc cohérente sans appel Stripe.
 */
export async function resolvePaidAccessViaStripe(
  accessToken: string,
  options?: { sessionId?: string | null },
): Promise<StripeAccessResolution> {
  if (!accessToken) {
    return { ok: false, reason: 'unauthorized' }
  }
  // Si pas de sessionId explicitement passé, on tente le pending localStorage.
  const sessionId = (options?.sessionId ?? readPendingStripeSessionId()) || null

  try {
    const res = await fetch('/api/stripe-resolve-access', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
    })
    if (res.status === 401) {
      return { ok: false, reason: 'unauthorized' }
    }
    if (!res.ok) {
      return { ok: false, reason: 'server_error' }
    }
    const data = (await res.json().catch(() => null)) as
      | StripeAccessResolution
      | { ok?: unknown; reason?: unknown }
      | null
    if (!data || typeof (data as { ok?: unknown }).ok !== 'boolean') {
      return { ok: false, reason: 'server_error' }
    }
    const resolution = data as StripeAccessResolution
    // Si on a réussi à lier via le session_id, on purge le localStorage
    // pour que les prochaines visites n'envoient pas une session déjà
    // consommée (et pour ne pas mélanger les comptes si l'utilisateur change).
    if (resolution.ok && sessionId) {
      clearPendingStripeSessionId()
    }
    return resolution
  } catch (e) {
    console.warn('[auth-access] resolvePaidAccessViaStripe a échoué :', e)
    return { ok: false, reason: 'network_error' }
  }
}
