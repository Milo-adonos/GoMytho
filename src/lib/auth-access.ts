// Règle d'accès à l'app GoMytho.
//
// Note : la création de compte n'est possible que via /signup après paiement
// Stripe → tout compte authentifié est considéré comme légitime à la
// connexion (cf. Login.tsx, AuthCallback.tsx, AppLayout.tsx). Ce module ne
// sert plus qu'à exposer un helper utilitaire utilisé sur /choixoffre pour
// rediriger un client déjà payant vers /dashboard.

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
 * repasser à la caisse.
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
