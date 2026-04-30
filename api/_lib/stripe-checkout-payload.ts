import Stripe from 'stripe'

// Le préfixe `_` du dossier `_lib/` indique à Vercel de NE PAS déployer ces
// fichiers comme endpoints (sinon `api/lib/...` devient un endpoint sans
// handler valide → 404 / 500 silencieux à l’import depuis stripe-verify).

const HEBDO_PRICE_ID = process.env.HEBDO_PRICE_ID || 'price_1TQbOECiUqAkK3BJpjzBf6kR'
const MENSU_PRICE_ID = process.env.MENSU_PRICE_ID || 'price_1TQbP8CiUqAkK3BJ1mBxAgqA'

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
  if (priceId === HEBDO_PRICE_ID) return 'weekly'
  if (priceId === MENSU_PRICE_ID) return 'monthly'
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
  const plan = planFromPriceId(priceId)
  if (!plan) {
    console.warn('[stripe-verify] price.id inconnu', {
      id: session.id,
      priceId,
      HEBDO_PRICE_ID,
      MENSU_PRICE_ID,
    })
    return null
  }

  const subscription = await resolveSubscription(session, stripe)
  const isTrialing = subscription?.status === 'trialing'
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
