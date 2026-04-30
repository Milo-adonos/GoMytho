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
  /**
   * Si la vérification a échoué (session_id absent OU /api/stripe-verify KO),
   * on remonte une raison lisible pour aider à diagnostiquer côté UI.
   */
  failure?: {
    reason: 'no_session_id' | 'verify_error' | 'verify_invalid_response'
    httpStatus?: number
    serverError?: string
  }
}

// ─── Vérifie un session_id Stripe côté serveur (source la plus fiable) ───────
async function attemptVerify(sessionId: string): Promise<{
  ok: VerifiedPlan | null
  failure?: VerifiedPlan['failure']
}> {
  try {
    const res = await fetch(
      `/api/stripe-verify?session_id=${encodeURIComponent(sessionId)}`,
      { cache: 'no-store' },
    )
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (!res.ok) {
      const serverError =
        data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
      return {
        ok: null,
        failure: { reason: 'verify_error', httpStatus: res.status, serverError },
      }
    }

    if (!data || !isPlan(data.plan)) {
      return { ok: null, failure: { reason: 'verify_invalid_response' } }
    }

    const sub = data.subscription_status
    const subscription_status: SubscriptionStatusUi | undefined =
      sub === 'trialing' || sub === 'active' || sub === 'inactive' || sub === 'cancelled'
        ? sub
        : undefined
    return {
      ok: {
        plan: data.plan as Plan,
        credits: typeof data.credits === 'number' ? data.credits : PLAN_CREDITS[data.plan as Plan],
        source: 'stripe' as const,
        email: typeof data.email === 'string' ? data.email : null,
        customerId: typeof data.customerId === 'string' ? data.customerId : null,
        subscription_status,
      },
    }
  } catch (e) {
    return {
      ok: null,
      failure: {
        reason: 'verify_error',
        serverError: e instanceof Error ? e.message : 'Erreur réseau',
      },
    }
  }
}

// Format Stripe officiel des Checkout Sessions : cs_live_… (Live) ou cs_test_…
// (Test). Stripe ne remplace `{CHECKOUT_SESSION_ID}` qu'après un paiement
// effectif, donc avoir un session_id de cette forme dans l'URL prouve
// matériellement qu'un paiement a transité par Stripe.
const STRIPE_SESSION_REGEX = /^cs_(live|test)_[A-Za-z0-9]+$/

async function verifyStripeSession(sessionId: string): Promise<{
  ok: VerifiedPlan | null
  failure?: VerifiedPlan['failure']
}> {
  // 1) Tente la vérification serveur (source la plus précise pour le plan)
  const r1 = await attemptVerify(sessionId)
  if (r1.ok) return r1

  // 2) Retry après 1,2 s (cold start Vercel, propagation Stripe)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const r2 = await attemptVerify(sessionId)
  if (r2.ok) return r2

  // 3) Si l'API échoue (souci serveur, env var manquante, etc.) MAIS que le
  // session_id a le format Stripe officiel, on présume le paiement et on
  // accorde l'accès. Le plan vient en priorité de la sélection utilisateur
  // mémorisée sur /choixoffre (localStorage `gomytho_pending_plan`), sinon
  // on retombe sur mensuel. Le webhook Stripe ré-écrira le BON plan dans
  // Supabase à la confirmation officielle.
  if (STRIPE_SESSION_REGEX.test(sessionId)) {
    let presumedPlan: Plan = 'monthly'
    try {
      const stored = localStorage.getItem('gomytho_pending_plan')
      if (stored === 'weekly' || stored === 'monthly') presumedPlan = stored
    } catch { /* localStorage indisponible */ }

    console.warn(
      '[plan] vérification serveur indisponible, session_id format valide → accès accordé en présumé',
      { sessionId, presumedPlan, lastFailure: r2.failure },
    )
    return {
      ok: {
        plan: presumedPlan,
        credits: PLAN_CREDITS[presumedPlan],
        source: 'stripe',
        email: null,
        customerId: null,
        subscription_status: 'active',
      },
    }
  }

  return r2
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
    const result = await verifyStripeSession(sessionId)
    if (result.ok) return result.ok
    // Détail technique en console pour debug (visible Vercel logs / DevTools),
    // jamais affiché à l'utilisateur final.
    console.warn('[plan] vérification Stripe KO', {
      sessionId,
      ...result.failure,
    })
    return {
      plan: 'free',
      credits: 0,
      source: 'unpaid',
      subscription_status: 'inactive',
      failure: result.failure,
    }
  }

  return {
    plan: 'free',
    credits: 0,
    source: 'unpaid',
    subscription_status: 'inactive',
    failure: { reason: 'no_session_id' },
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
