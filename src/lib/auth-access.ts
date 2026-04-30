// Règle d’accès à l’app GoMytho (hors parcours paiement Stripe en cours).

export type UserAccessProfile = {
  plan?: string | null
  subscription_status?: string | null
  credits_remaining?: number | null
  stripe_customer_id?: string | null
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
