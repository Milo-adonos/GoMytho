// Règle d'accès à l'app GoMytho.
//
// Avec le flux d'inscription AVANT paiement + utilisation de
// `client_reference_id` côté Stripe, le webhook lie toujours le
// Customer Stripe par user.id Supabase. Donc la table public.users
// est la source de vérité unique : si elle ne montre pas d'abo, c'est
// qu'il n'y en a pas (ou que le webhook est en retard de quelques
// secondes — géré par AppLayout via polling + appel à /api/stripe-verify).

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
 *
 * On ne considère PAS le simple fait d'avoir un `stripe_customer_id`
 * comme une preuve d'accès payant — un Customer Stripe persiste après
 * refund / cancel, et un vieux test peut laisser une référence orpheline.
 *
 * La preuve fiable :
 *   - des crédits > 0, OU
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

/** Lit le profil DB d'un utilisateur par son user.id Supabase. */
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
 *   webhook peut ne pas avoir fini, on lui laisse le bénéfice du doute.
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

const STRIPE_SESSION_REGEX = /^cs_(live|test)_[A-Za-z0-9]+$/

/**
 * Lit un session_id Stripe « pending » dans localStorage (posé par
 * /paiementreussi). Survit aux refresh sans query string et fermetures
 * d'onglet partielles.
 */
export function readPendingStripeSessionId(): string | null {
  try {
    const raw = localStorage.getItem('gomytho_pending_session_id')
    if (!raw) return null
    const trimmed = raw.trim()
    if (!STRIPE_SESSION_REGEX.test(trimmed)) return null
    return trimmed
  } catch {
    return null
  }
}

export function clearPendingStripeSessionId() {
  try {
    localStorage.removeItem('gomytho_pending_session_id')
  } catch { /* ignore */ }
}

/**
 * Clé sessionStorage utilisée pour transmettre un message d'erreur
 * d'accès depuis AuthCallback / AppLayout jusqu'à la page de
 * destination (`/login` ou `/choixoffre`).
 */
export const NO_SUBSCRIPTION_FLAG_KEY = 'gomytho_no_subscription_msg'
