import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { retrieveAndBuildCheckoutPayload, type VerifiedCheckoutPayload } from './_lib/stripe-checkout-payload'

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

async function syncSupabaseUserFromPayload(
  supabaseUrl: string,
  serviceKey: string,
  payload: VerifiedCheckoutPayload,
) {
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
  if (emailNorm) {
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

/**
 * Enregistre le checkout dans `stripe_pending_links` pour qu'il soit
 * récupérable par session_id / customer_id / email lors d'une connexion
 * ultérieure — même si le user Supabase n'existe pas encore, ou s'inscrit
 * plus tard sur un autre device avec un email différent.
 *
 * Idempotent : `session_id` est PRIMARY KEY → upsert.
 */
async function recordPendingLink(
  supabaseUrl: string,
  serviceKey: string,
  sessionId: string,
  payload: VerifiedCheckoutPayload,
) {
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
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed')
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!stripeSecret || !whSecret) {
    console.error('[stripe-webhook] missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
    return res.status(500).json({ error: 'Webhook non configuré' })
  }

  const sig = req.headers['stripe-signature']
  if (!sig || typeof sig !== 'string') {
    return res.status(400).send('Missing stripe-signature')
  }

  let buf: Buffer
  try {
    buf = await readRawBody(req)
    if (!buf.length && typeof req.body === 'string') {
      buf = Buffer.from(req.body)
    }
  } catch (e) {
    console.error('[stripe-webhook] read body', e)
    return res.status(400).send('Invalid body')
  }

  const stripe = new Stripe(stripeSecret)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(buf, sig, whSecret)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[stripe-webhook] signature', msg)
    return res.status(400).send(`Webhook Error: ${msg}`)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const payload = await retrieveAndBuildCheckoutPayload(stripe, session.id)
        if (supabaseUrl && serviceKey && payload) {
          // 1) On enregistre TOUJOURS la liaison dans stripe_pending_links,
          //    AVANT toute tentative de mise à jour. Si la mise à jour des
          //    `users` échoue (user pas encore créé, RLS, race), la liaison
          //    reste récupérable plus tard via /api/stripe-resolve-access.
          await recordPendingLink(supabaseUrl, serviceKey, session.id, payload)
          // 2) Tentative de mise à jour directe de la table `users`.
          //    Continue d'être faite dès que possible pour les flux nominaux.
          await syncSupabaseUserFromPayload(supabaseUrl, serviceKey, payload)
        } else if (!payload) {
          console.warn('[stripe-webhook] checkout.session.completed — payload null', session.id)
        }
        break
      }
      default:
        break
    }
  } catch (e) {
    console.error('[stripe-webhook] handler', e)
    return res.status(500).json({ error: 'Traitement webhook échoué' })
  }

  return res.status(200).json({ received: true })
}
