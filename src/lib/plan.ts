// ─── Source de vérité unique pour les plans + crédits ────────────────────────
// Tout le code applicatif passe par ces helpers pour résoudre :
//   - le plan que l'utilisateur a payé (weekly | monthly | free)
//   - le nombre de crédits à attribuer
//   - la source la plus fiable (Stripe > URL > localStorage > défaut)

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
  source: 'stripe' | 'url' | 'storage' | 'default'
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
      source: 'stripe',
      email: data.email || null,
      customerId: data.customerId || null,
      subscription_status,
    }
  } catch {
    return null
  }
}

// ─── Résout le plan effectif pour un nouvel utilisateur ──────────────────────
// Ordre de priorité :
//   1. Vérification Stripe (session_id) — anti-fraude, anti-perte localStorage
//   2. Param URL ?plan= (ex: /signup?plan=monthly)
//   3. localStorage gomytho_pending_plan (set avant le redirect Stripe)
//   4. Défaut "monthly" (le plus charitable, garantit que le user paye-t-il a des crédits)
export async function resolveNewUserPlan(searchParams: URLSearchParams): Promise<VerifiedPlan> {
  const sessionId = searchParams.get('session_id')
  if (sessionId) {
    const verified = await verifyStripeSession(sessionId)
    if (verified) return verified
  }

  const urlPlan = searchParams.get('plan')
  if (isPlan(urlPlan)) {
    return { plan: urlPlan, credits: PLAN_CREDITS[urlPlan], source: 'url' }
  }

  try {
    const stored = localStorage.getItem('gomytho_pending_plan')
    if (isPlan(stored)) {
      return { plan: stored, credits: PLAN_CREDITS[stored], source: 'storage' }
    }
  } catch { /* ignore */ }

  return { plan: 'monthly', credits: PLAN_CREDITS.monthly, source: 'default' }
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
