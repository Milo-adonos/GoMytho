// Règle d’accès à l’app GoMytho (hors parcours paiement Stripe en cours).

import { supabase } from './supabase'

export type UserAccessProfile = {
  plan?: string | null
  subscription_status?: string | null
  credits_remaining?: number | null
  stripe_customer_id?: string | null
  stripe_payment_email?: string | null
  email?: string | null
} | null

/**
 * True si l’utilisateur a le droit d’utiliser l’app (abonnement, essai, ancien
 * abonné, ou crédits restants). False pour les comptes « vides » créés par OAuth
 * sans paiement (trigger Supabase → plan free / inactive / 0 crédit).
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

const PROFILE_COLUMNS =
  'plan, subscription_status, credits_remaining, stripe_customer_id, stripe_payment_email, email'

/**
 * Récupère le profil d'accès d'un utilisateur connecté, avec fallback par email.
 *
 * Pourquoi ce fallback ?
 *   Quand un client paye + crée son compte avec email/mot de passe puis
 *   essaye plus tard de se connecter via Google, Supabase peut créer une
 *   NOUVELLE auth.user (id différent) si l'identity linking n'est pas activé.
 *   Le profil payé est lié à l'ancien id → la requête `eq('id', new_id)`
 *   ne trouve rien → l'utilisateur est rejeté à tort.
 *
 *   Fallback : si pas de profil pour cet id mais l'email a un profil PAYÉ,
 *   on copie ces données (plan, crédits, status, customer Stripe) sur le
 *   nouvel id. Ainsi le client retrouve son accès quel que soit le mode
 *   d'authentification utilisé pour se reconnecter.
 *
 *   Sécurité : Google vérifie que l'utilisateur possède bien l'email avant
 *   de signer le token OAuth. On peut donc faire confiance à `session.user.email`.
 */
export async function resolveAccessProfile(
  userId: string,
  email: string | null | undefined,
): Promise<UserAccessProfile> {
  // 1) Lookup direct par id (chemin nominal)
  const { data: byId } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle()

  if (byId && hasPaidGoMythoAccess(byId)) return byId

  // 2) Fallback par email — utile si l'utilisateur a payé sous un autre auth
  if (!email) return byId ?? null

  const { data: byEmail } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('email', email)
    .maybeSingle()

  if (byEmail && hasPaidGoMythoAccess(byEmail)) {
    // Synchronise les données payantes vers le user_id courant pour que les
    // futures requêtes par id fonctionnent (et que la création de mythos /
    // les crédits soient liés au compte connecté actif).
    try {
      await supabase.from('users').upsert(
        [{
          id: userId,
          email,
          plan: byEmail.plan,
          subscription_status: byEmail.subscription_status,
          credits_remaining: byEmail.credits_remaining,
          stripe_customer_id: byEmail.stripe_customer_id ?? null,
          stripe_payment_email: byEmail.stripe_payment_email ?? null,
        }],
        { onConflict: 'id' },
      )
    } catch (err) {
      console.warn('[auth-access] sync byEmail → byId échoué (non bloquant):', err)
    }
    return byEmail
  }

  // 3) Fallback : si stripe_payment_email matche (client a payé Apple Pay /
  // alias avec un email différent de celui du compte)
  const { data: byStripeEmail } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('stripe_payment_email', email)
    .maybeSingle()

  if (byStripeEmail && hasPaidGoMythoAccess(byStripeEmail)) {
    try {
      await supabase.from('users').upsert(
        [{
          id: userId,
          email,
          plan: byStripeEmail.plan,
          subscription_status: byStripeEmail.subscription_status,
          credits_remaining: byStripeEmail.credits_remaining,
          stripe_customer_id: byStripeEmail.stripe_customer_id ?? null,
          stripe_payment_email: byStripeEmail.stripe_payment_email ?? null,
        }],
        { onConflict: 'id' },
      )
    } catch (err) {
      console.warn('[auth-access] sync byStripeEmail → byId échoué (non bloquant):', err)
    }
    return byStripeEmail
  }

  return byId ?? null
}
