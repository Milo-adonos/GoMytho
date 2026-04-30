// ─── Source de vérité unique pour les plans + crédits ────────────────────────
// Le plan payant et les crédits d’abonnement ne viennent que de stripe-verify
// (session_id) ou d’une mise à jour serveur (webhook). Pas de déduction depuis
// l’URL ou le seul localStorage.

export type Plan = 'weekly' | 'monthly' | 'free'

/** Crédits consommés par une génération (1 mytho). */
export const CREDITS_PER_IMAGE = 8

/**
 * Essai gratuit de l’offre mensuelle : 1 seule génération, puis abonnement payant.
 * Aligné sur CREDITS_PER_IMAGE (une fois l’essai converti, le quota mensuel complet s’applique).
 */
export const MONTHLY_TRIAL_CREDITS = CREDITS_PER_IMAGE

export type SubscriptionStatusUi = 'active' | 'inactive' | 'cancelled' | 'trialing'

export const PLAN_CREDITS: Record<Plan, number> = {
  weekly: 160,
  monthly: 560,
  free: 3,
}

export const PLAN_LABELS: Record<Plan, string> = {
  weekly: 'hebdomadaire',
  monthly: 'mensuel',
  free: 'gratuit',
}

const isPlan = (v: unknown): v is Plan =>
  v === 'weekly' || v === 'monthly' || v === 'free'

export interface VerifiedPlan {
  plan: Plan
  credits: number
  source: 'stripe' | 'unpaid'
  email?: string | null
  customerId?: string | null
  subscription_status?: SubscriptionStatusUi
}

// ─── Vérifie un session_id Stripe côté serveur (source la plus fiable) ───────
async function verifyStripeSession(sessionId: string): Promise<VerifiedPlan | null> {
  try {
    const res = await fetch(`/api/stripe-verify?session_id=${encodeURIComponent(sessionId)}`)
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (!data || !isPlan(data.plan)) return null
    const sub = data.subscription_status
    const subscription_status: SubscriptionStatusUi | undefined =
      sub === 'trialing' || sub === 'active' || sub === 'inactive' || sub === 'cancelled'
        ? sub
        : undefined
    return {
      plan: data.plan,
      credits: typeof data.credits === 'number' ? data.credits : PLAN_CREDITS[data.plan as Plan],
      source: 'stripe' as const,
      email: data.email || null,
      customerId: data.customerId || null,
      subscription_status,
    }
  } catch {
    return null
  }
}

// ─── Résout le plan effectif pour un nouvel utilisateur ──────────────────────
//
// Règle anti-fraude : aucun plan payant ni crédits d’abonnement sans
// vérification serveur du Checkout Stripe (session_id). Sinon n’importe qui
// pouvait obtenir 560 crédits via ?plan=, leftover localStorage, ou le défaut.
// Les payeurs légitimes arrivent avec session_id (Payment Link → URL de succès)
// ou profil déjà MIS à JOUR par webhook avant connexion (hasPaidGoMythoAccess).
export async function resolveNewUserPlan(searchParams: URLSearchParams): Promise<VerifiedPlan> {
  const sessionId = searchParams.get('session_id')
  if (sessionId) {
    const verified = await verifyStripeSession(sessionId)
    if (verified) return verified
  }

  return {
    plan: 'free',
    credits: 0,
    source: 'unpaid',
    subscription_status: 'inactive',
  }
}

// ─── Cache local du plan effectif de l'utilisateur connecté ──────────────────
export function cachePlanLocally(plan: Plan, credits: number) {
  try {
    localStorage.setItem('gomytho_user_plan', plan)
    localStorage.setItem('gomytho_user_credits', String(credits))
  } catch { /* ignore */ }
}

export function readCachedPlan(): { plan: Plan; credits: number } {
  try {
    const plan = localStorage.getItem('gomytho_user_plan')
    const creditsRaw = Number(localStorage.getItem('gomytho_user_credits') || NaN)
    return {
      plan: isPlan(plan) ? plan : 'monthly',
      credits: Number.isFinite(creditsRaw) ? creditsRaw : 0,
    }
  } catch {
    return { plan: 'monthly', credits: 0 }
  }
}
