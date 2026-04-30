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
 * Identifie le plan depuis le montant total réellement encaissé.
 * `amount_total` peut être null pour des sessions « subscription » sans
 * paiement immédiat (essai gratuit), `unit_amount` du price est alors lu.
 */
function planFromAmount(
  amountTotal: number | null | undefined,
  unitAmount: number | null | undefined,
): { plan: 'weekly' | 'monthly'; trial: boolean } | null {
  // Essai gratuit (montant 0 mais unit_amount du prix correspond à mensuel)
  if ((amountTotal === 0 || amountTotal == null) && unitAmount === MENSU_AMOUNT_CENTS) {
    return { plan: 'monthly', trial: true }
  }
  if (amountTotal === HEBDO_AMOUNT_CENTS) return { plan: 'weekly', trial: false }
  if (amountTotal === MENSU_AMOUNT_CENTS) return { plan: 'monthly', trial: false }
  // Tolérance ±1 centime (arrondis devises)
  if (amountTotal && Math.abs(amountTotal - HEBDO_AMOUNT_CENTS) <= 1) return { plan: 'weekly', trial: false }
  if (amountTotal && Math.abs(amountTotal - MENSU_AMOUNT_CENTS) <= 1) return { plan: 'monthly', trial: false }
  return null
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

  // 1) Match strict par price_id si HEBDO/MENSU configurés correctement.
  // 2) Sinon fallback fiable par MONTANT (paiement vérifié par Stripe).
  let plan = planFromPriceId(priceId)
  let trialFromAmount = false
  if (!plan) {
    const fallback = planFromAmount(session.amount_total, unitAmount)
    if (fallback) {
      plan = fallback.plan
      trialFromAmount = fallback.trial
      console.warn('[stripe-verify] price_id inconnu, plan déduit du montant', {
        id: session.id,
        priceId,
        amount_total: session.amount_total,
        unit_amount: unitAmount,
        plan,
      })
    }
  }
  if (!plan) {
    console.warn('[stripe-verify] plan introuvable (price_id + montant)', {
      id: session.id,
      priceId,
      amount_total: session.amount_total,
      unit_amount: unitAmount,
    })
    return null
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
