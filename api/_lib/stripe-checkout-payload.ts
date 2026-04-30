import Stripe from 'stripe'

// Le préfixe `_` du dossier `_lib/` indique à Vercel de NE PAS déployer ces
// fichiers comme endpoints (sinon `api/lib/...` devient un endpoint sans
// handler valide → 404 / 500 silencieux à l’import depuis stripe-verify).

const HEBDO_PRICE_ID = (process.env.HEBDO_PRICE_ID || '').trim()
const MENSU_PRICE_ID = (process.env.MENSU_PRICE_ID || '').trim()

// Fallback robuste basé sur le montant : si HEBDO_PRICE_ID / MENSU_PRICE_ID ne
// sont pas configurés (ou contiennent des placeholders), on identifie le plan
// par le montant payé (2,99 € = weekly, 9,90 € = monthly, 0 = essai mensuel).
// Évite que des clients qui ont VRAIMENT payé soient bloqués sur /signup.
const HEBDO_AMOUNT_CENTS = 299
const MENSU_AMOUNT_CENTS = 990

const PLAN_CREDITS: Record<'weekly' | 'monthly' | 'free', number> = {
  weekly: 160,
  monthly: 560,
  free: 3,
}

const CREDITS_PER_IMAGE = 8
const MONTHLY_TRIAL_CREDITS = CREDITS_PER_IMAGE

export type VerifiedCheckoutPayload = {
  plan: 'weekly' | 'monthly'
  credits: number
  subscription_status: 'active' | 'trialing'
  email: string | null
  customerId: string | null
}

function planFromPriceId(priceId: string | undefined | null): 'weekly' | 'monthly' | null {
  if (!priceId) return null
  if (HEBDO_PRICE_ID && priceId === HEBDO_PRICE_ID) return 'weekly'
  if (MENSU_PRICE_ID && priceId === MENSU_PRICE_ID) return 'monthly'
  return null
}

/**
 * Détermine le plan en se basant prioritairement sur `unit_amount` (le prix
 * configuré en DUR sur le produit Stripe), puis `amount_total` (montant
 * réellement débité après réductions/coupons). Renvoie toujours un plan tant
 * qu'on a une trace numérique du paiement.
 */
function planFromAmount(
  amountTotal: number | null | undefined,
  unitAmount: number | null | undefined,
): { plan: 'weekly' | 'monthly'; trial: boolean } {
  const trial = amountTotal === 0 || amountTotal == null
  // Le unit_amount est plus fiable (pas affecté par coupons / promos)
  const reference = unitAmount ?? amountTotal ?? 0

  // Match exact / proche du tarif hebdo (2,99 €)
  if (Math.abs(reference - HEBDO_AMOUNT_CENTS) <= 5) return { plan: 'weekly', trial }
  // Match exact / proche du tarif mensuel (9,90 €)
  if (Math.abs(reference - MENSU_AMOUNT_CENTS) <= 5) return { plan: 'monthly', trial }

  // Plages tolérantes : tout paiement < 5 € → weekly, >= 5 € → monthly.
  // Évite de bloquer un client qui a payé un prix légèrement différent
  // (promo, ajustement futur, devise locale convertie, etc.).
  if (reference > 0 && reference < 500) return { plan: 'weekly', trial }
  return { plan: 'monthly', trial }
}

async function resolveSubscription(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
): Promise<Stripe.Subscription | null> {
  const sub = session.subscription
  if (!sub) return null
  if (typeof sub === 'string') return stripe.subscriptions.retrieve(sub)
  return sub as Stripe.Subscription
}

export async function buildVerifiedPayloadFromSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<VerifiedCheckoutPayload | null> {
  const paidLike =
    session.payment_status === 'paid' ||
    session.payment_status === 'no_payment_required'

  if (session.status !== 'complete' || !paidLike) {
    console.warn('[stripe-verify] session non finalisée', {
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
    })
    return null
  }

  const lineItem = session.line_items?.data?.[0]
  const priceId = (lineItem?.price?.id as string | undefined) || null
  const unitAmount = (lineItem?.price?.unit_amount as number | undefined) ?? null

  // 1) Match strict par price_id si HEBDO/MENSU sont en env vars Vercel.
  // 2) Sinon, on déduit du MONTANT (toujours présent côté Stripe).
  // La fonction planFromAmount renvoie toujours un plan → pas de blocage
  // possible pour un client dont Stripe a confirmé le paiement.
  let plan = planFromPriceId(priceId)
  const fallback = planFromAmount(session.amount_total, unitAmount)
  let trialFromAmount = false
  if (!plan) {
    plan = fallback.plan
    trialFromAmount = fallback.trial
    console.info('[stripe-verify] plan déduit du montant', {
      id: session.id,
      priceId,
      amount_total: session.amount_total,
      unit_amount: unitAmount,
      plan,
      trial: fallback.trial,
    })
  } else {
    console.info('[stripe-verify] plan reconnu via price_id', { id: session.id, plan })
  }

  const subscription = await resolveSubscription(session, stripe)
  const isTrialing = subscription?.status === 'trialing' || trialFromAmount
  const credits = plan === 'monthly' && isTrialing ? MONTHLY_TRIAL_CREDITS : PLAN_CREDITS[plan]
  const subscription_status = plan === 'monthly' && isTrialing ? 'trialing' : 'active'

  return {
    plan,
    credits,
    subscription_status,
    email: session.customer_details?.email || session.customer_email || null,
    customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
  }
}

export async function retrieveAndBuildCheckoutPayload(
  stripe: Stripe,
  sessionId: string,
): Promise<VerifiedCheckoutPayload | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'line_items.data.price', 'subscription'],
  })

  // Certains parcours Payment Link renvoient line_items vide même avec expand ;
  // listLineItems est la source fiable du price.id.
  if (!session.line_items?.data?.length) {
    const { data: items } = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 10,
      expand: ['data.price'],
    })
    if (items.length) {
      const merged = {
        ...session,
        line_items: {
          object: 'list' as const,
          data: items,
          has_more: false,
          url: '',
        },
      }
      return buildVerifiedPayloadFromSession(stripe, merged as Stripe.Checkout.Session)
    }
  }

  return buildVerifiedPayloadFromSession(stripe, session)
}
