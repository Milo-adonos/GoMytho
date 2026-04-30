import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'

// ─── Vérification serveur d'un paiement Stripe ────────────────────────────────
//
// Endpoint appelé après le redirect Stripe Payment Link → /signup?session_id=...
// Retourne le plan réellement payé (weekly/monthly) en interrogeant Stripe.
//
// Essai gratuit mensuel : si l’abonnement Stripe est en `trialing`, on ne donne
// que MONTHLY_TRIAL_CREDITS (1 mytho). Le quota mensuel complet est appliqué
// quand l’essai se termine (voir api/stripe-sync-trial.ts).

const HEBDO_PRICE_ID = process.env.HEBDO_PRICE_ID || 'price_1TQbOECiUqAkK3BJpjzBf6kR'
const MENSU_PRICE_ID = process.env.MENSU_PRICE_ID || 'price_1TQbP8CiUqAkK3BJ1mBxAgqA'

const PLAN_CREDITS: Record<'weekly' | 'monthly' | 'free', number> = {
  weekly: 160,
  monthly: 560,
  free: 3,
}

/** 1 mytho = même unité que côté app (AppCreate). */
const CREDITS_PER_IMAGE = 8
const MONTHLY_TRIAL_CREDITS = CREDITS_PER_IMAGE

function planFromPriceId(priceId: string | undefined | null): 'weekly' | 'monthly' | null {
  if (!priceId) return null
  if (priceId === HEBDO_PRICE_ID) return 'weekly'
  if (priceId === MENSU_PRICE_ID) return 'monthly'
  return null
}

function resolveSubscription(
  session: Stripe.Checkout.Session,
  stripe: Stripe
): Promise<Stripe.Subscription | null> {
  const sub = session.subscription
  if (!sub) return Promise.resolve(null)
  if (typeof sub === 'string') return stripe.subscriptions.retrieve(sub)
  return Promise.resolve(sub as Stripe.Subscription)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY
  if (!stripeSecret) {
    return res.status(500).json({ error: 'Stripe non configuré côté serveur' })
  }

  const sessionId =
    (req.query.session_id as string | undefined) ||
    (req.body && (req.body as any).session_id) ||
    ''

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'session_id manquant' })
  }

  try {
    const stripe = new Stripe(stripeSecret)
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'line_items.data.price', 'subscription'],
    })

    const paidLike =
      session.payment_status === 'paid' ||
      session.payment_status === 'no_payment_required'

    if (session.status !== 'complete' || !paidLike) {
      return res.status(402).json({
        error: 'Paiement non finalisé',
        payment_status: session.payment_status,
        status: session.status,
      })
    }

    const lineItem = session.line_items?.data?.[0]
    const priceId = (lineItem?.price?.id as string | undefined) || null
    const plan = planFromPriceId(priceId)

    if (!plan) {
      return res.status(400).json({
        error: 'Plan non reconnu',
        priceId,
        hint: 'Vérifie HEBDO_PRICE_ID / MENSU_PRICE_ID dans les variables d\'environnement Vercel.',
      })
    }

    const subscription = await resolveSubscription(session, stripe)
    const isTrialing = subscription?.status === 'trialing'

    const credits =
      plan === 'monthly' && isTrialing ? MONTHLY_TRIAL_CREDITS : PLAN_CREDITS[plan]

    const subscription_status = plan === 'monthly' && isTrialing ? 'trialing' : 'active'

    return res.status(200).json({
      plan,
      credits,
      email: session.customer_details?.email || session.customer_email || null,
      customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
      subscription_status,
    })
  } catch (err: any) {
    console.error('[stripe-verify] error', err?.message || err)
    return res.status(500).json({ error: err?.message || 'Vérification Stripe impossible' })
  }
}
