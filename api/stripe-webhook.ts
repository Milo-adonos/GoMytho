import type { VercelRequest, VercelResponse } from '@vercel/node'
import type StripeType from 'stripe'

// Imports lourds en DYNAMIC : sur Node v24+ Vercel, certains modules
// (notamment le SDK Stripe) plantent au top-level → FUNCTION_INVOCATION_FAILED.
// On charge tout dans le handler avec un try/catch dédié pour avoir
// un message JSON clair en cas d'échec.

// Durée max côté Vercel ; le corps doit rester brut pour la signature Stripe
// (lecture via flux req, sans parsing JSON amont).
export const config = {
  maxDuration: 30,
}

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: string | Buffer) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type VerifiedCheckoutPayload = {
  plan: 'weekly' | 'monthly'
  credits: number
  subscription_status: 'active' | 'trialing'
  email: string | null
  customerId: string | null
}

// ─── Helper inliné (Vercel ne bundle pas les dynamic imports locaux) ─────
const HEBDO_PRICE_ID = (process.env.HEBDO_PRICE_ID || '').trim()
const MENSU_PRICE_ID = (process.env.MENSU_PRICE_ID || '').trim()
const HEBDO_AMOUNT_CENTS = 299
const MENSU_AMOUNT_CENTS = 990
const PLAN_CREDITS_MAP: Record<'weekly' | 'monthly', number> = { weekly: 160, monthly: 560 }
const MONTHLY_TRIAL_CREDITS = 8

function planFromPriceId(priceId: string | undefined | null): 'weekly' | 'monthly' | null {
  if (!priceId) return null
  if (HEBDO_PRICE_ID && priceId === HEBDO_PRICE_ID) return 'weekly'
  if (MENSU_PRICE_ID && priceId === MENSU_PRICE_ID) return 'monthly'
  return null
}

function planFromAmount(
  amountTotal: number | null | undefined,
  unitAmount: number | null | undefined,
): { plan: 'weekly' | 'monthly'; trial: boolean } {
  const trial = amountTotal === 0 || amountTotal == null
  const reference = unitAmount ?? amountTotal ?? 0
  if (Math.abs(reference - HEBDO_AMOUNT_CENTS) <= 5) return { plan: 'weekly', trial }
  if (Math.abs(reference - MENSU_AMOUNT_CENTS) <= 5) return { plan: 'monthly', trial }
  if (reference > 0 && reference < 500) return { plan: 'weekly', trial }
  return { plan: 'monthly', trial }
}

async function buildVerifiedPayloadFromSession(
  stripe: StripeType,
  session: StripeType.Checkout.Session,
): Promise<VerifiedCheckoutPayload | null> {
  const paidLike =
    session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
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
  let plan = planFromPriceId(priceId)
  const fallback = planFromAmount(session.amount_total, unitAmount)
  let trialFromAmount = false
  if (!plan) {
    plan = fallback.plan
    trialFromAmount = fallback.trial
  }
  let subscription: StripeType.Subscription | null = null
  const sub = session.subscription
  if (sub) {
    subscription = typeof sub === 'string' ? await stripe.subscriptions.retrieve(sub) : sub
  }
  const isTrialing = subscription?.status === 'trialing' || trialFromAmount
  const credits = plan === 'monthly' && isTrialing ? MONTHLY_TRIAL_CREDITS : PLAN_CREDITS_MAP[plan]
  const subscription_status: 'active' | 'trialing' =
    plan === 'monthly' && isTrialing ? 'trialing' : 'active'
  return {
    plan,
    credits,
    subscription_status,
    email: session.customer_details?.email || session.customer_email || null,
    customerId:
      typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
  }
}

async function retrieveAndBuildCheckoutPayload(
  stripe: StripeType,
  sessionId: string,
): Promise<VerifiedCheckoutPayload | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'line_items.data.price', 'subscription'],
  })
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
      return buildVerifiedPayloadFromSession(stripe, merged as StripeType.Checkout.Session)
    }
  }
  return buildVerifiedPayloadFromSession(stripe, session)
}

async function syncSupabaseUserFromPayload(
  supabaseUrl: string,
  serviceKey: string,
  payload: VerifiedCheckoutPayload,
  clientReferenceId: string | null,
) {
  const { createClient } = await import('@supabase/supabase-js')
  const emailNorm = payload.email?.trim().toLowerCase() || ''
  const cid = payload.customerId || ''
  const row = {
    plan: payload.plan,
    credits_remaining: payload.credits,
    subscription_status: payload.subscription_status,
    stripe_customer_id: cid || null,
    stripe_payment_email: emailNorm || null,
  }
  const supabase = createClient(supabaseUrl, serviceKey)
  let updated = false

  // 1. Priorité : client_reference_id (= user.id Supabase)
  if (clientReferenceId && UUID_REGEX.test(clientReferenceId)) {
    const r0 = await supabase
      .from('users')
      .update(row)
      .eq('id', clientReferenceId)
      .select('id')
    if (r0.data?.length) updated = true
  }

  // 2. Fallback email
  if (!updated && emailNorm) {
    const r1 = await supabase.from('users').update(row).eq('email', emailNorm).select('id')
    if (r1.data?.length) { updated = true }
    if (!updated) {
      const r2 = await supabase
        .from('users')
        .update(row)
        .eq('stripe_payment_email', emailNorm)
        .select('id')
      if (r2.data?.length) updated = true
    }
  }
  if (!updated && cid) {
    const r3 = await supabase.from('users').update(row).eq('stripe_customer_id', cid).select('id')
    if (r3.data?.length) updated = true
  }
  return updated
}

async function recordPendingLink(
  supabaseUrl: string,
  serviceKey: string,
  sessionId: string,
  payload: VerifiedCheckoutPayload,
) {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(supabaseUrl, serviceKey)
  const row = {
    session_id: sessionId,
    customer_id: payload.customerId || '',
    stripe_email: payload.email?.trim().toLowerCase() || null,
    plan: payload.plan,
    credits: payload.credits,
    subscription_status: payload.subscription_status,
  }
  if (!row.customer_id) {
    console.warn('[stripe-webhook] pending link skipped (no customer_id)', sessionId)
    return
  }
  try {
    const { error } = await supabase
      .from('stripe_pending_links')
      .upsert([row], { onConflict: 'session_id' })
    if (error) {
      console.warn('[stripe-webhook] pending link upsert error:', error.message)
    }
  } catch (e) {
    console.warn('[stripe-webhook] pending link exception:', (e as Error)?.message)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Wrap absolu : aucune exception ne doit faire passer Vercel en
  // FUNCTION_INVOCATION_FAILED. Réponse JSON garantie en toutes circonstances.
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const stripeSecret = (process.env.STRIPE_SECRET_KEY || '').trim()
    const whSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim()
    const supabaseUrl =
      (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim() || ''
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || ''

    const missing: string[] = []
    if (!stripeSecret) missing.push('STRIPE_SECRET_KEY')
    if (!whSecret) missing.push('STRIPE_WEBHOOK_SECRET')
    if (!supabaseUrl) missing.push('SUPABASE_URL')
    if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (missing.length) {
      const errMsg = `Variables d'env Vercel manquantes : ${missing.join(', ')}`
      console.error('[stripe-webhook]', errMsg)
      return res.status(500).json({ error: errMsg })
    }

    const sig = req.headers['stripe-signature']
    if (!sig || typeof sig !== 'string') {
      return res.status(400).json({ error: 'Missing stripe-signature' })
    }

    let buf: Buffer
    try {
      buf = await readRawBody(req)
      if (!buf.length && typeof req.body === 'string') {
        buf = Buffer.from(req.body)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[stripe-webhook] read body', msg)
      return res.status(400).json({ error: `Invalid body: ${msg}` })
    }

    // Imports lourds en dynamic.
    let Stripe: typeof StripeType
    try {
      const m = await import('stripe')
      Stripe = m.default
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[stripe-webhook] Stripe SDK import', msg)
      return res.status(500).json({ error: `Stripe SDK import: ${msg}` })
    }

    let stripe: StripeType
    try {
      stripe = new Stripe(stripeSecret)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[stripe-webhook] Stripe SDK init', msg)
      return res.status(500).json({ error: `Stripe SDK init: ${msg}` })
    }

    let event: StripeType.Event
    try {
      event = stripe.webhooks.constructEvent(buf, sig, whSecret)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[stripe-webhook] signature', msg)
      return res.status(400).json({ error: `Webhook signature failed: ${msg}` })
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as StripeType.Checkout.Session
          const payload = await retrieveAndBuildCheckoutPayload(stripe, session.id)
          const clientReferenceId =
            typeof session.client_reference_id === 'string' && session.client_reference_id.trim()
              ? session.client_reference_id.trim()
              : null
          if (payload) {
            await recordPendingLink(supabaseUrl, serviceKey, session.id, payload)
            await syncSupabaseUserFromPayload(
              supabaseUrl,
              serviceKey,
              payload,
              clientReferenceId,
            )
          } else {
            console.warn('[stripe-webhook] checkout.session.completed — payload null', session.id)
          }
          break
        }
        default:
          break
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error ? e.stack : ''
      console.error('[stripe-webhook] handler exception:', msg, stack)
      return res.status(500).json({
        error: `Traitement webhook échoué : ${msg}`,
      })
    }

    return res.status(200).json({ received: true })
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal)
    const stack = fatal instanceof Error ? fatal.stack : ''
    console.error('[stripe-webhook] FATAL:', msg, stack)
    try {
      return res.status(500).json({ error: `Webhook fatal: ${msg}` })
    } catch {
      return res.status(500).end(`Webhook fatal: ${msg}`)
    }
  }
}
