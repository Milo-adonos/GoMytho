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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function syncSupabaseUserFromPayload(
  supabaseUrl: string,
  serviceKey: string,
  payload: VerifiedCheckoutPayload,
  /**
   * `client_reference_id` posé par le frontend dans la session Checkout
   * (au moment du redirect vers Stripe). On y stocke TOUJOURS le user.id
   * Supabase de l'utilisateur authentifié — cf. nouveau flux « inscription
   * AVANT paiement » : on a la garantie que le compte existe déjà et que
   * son ID est connu côté client. Avec ça, plus aucun match d'email n'est
   * nécessaire — la liaison se fait par ID, donc :
   *   • Apple Pay / Google Pay / Revolut Pay / alias → email Stripe peut
   *     être totalement différent, ça marche quand même
   *   • Cross-device / casse / accents → idem, ça marche
   *   • Pas de race condition « webhook avant signup » → l'utilisateur
   *     existe forcément.
   */
  clientReferenceId: string | null,
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

  // ─── 1. PRIORITÉ ABSOLUE : client_reference_id (= user.id Supabase) ──
  // C'est la voie « propre » du nouveau flux. Si elle marche, on s'arrête là.
  if (clientReferenceId && UUID_REGEX.test(clientReferenceId)) {
    const r0 = await supabase
      .from('users')
      .update(row)
      .eq('id', clientReferenceId)
      .select('id')
    if (r0.data?.length) updated = true
  }

  // ─── 2. Fallback email (anciens comptes / liens non passés par /signup) ──
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

  const stripeSecret = (process.env.STRIPE_SECRET_KEY || '').trim()
  const whSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim()
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim() || ''
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || ''

  // Diagnostic explicite : on liste précisément quelle variable manque.
  // Le message de retour est lu dans Stripe Dashboard → Webhooks → Réponse.
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
        // `client_reference_id` est posé par le frontend (Unlock.tsx /
        // Signup.tsx) avec le user.id Supabase de l'utilisateur authentifié.
        // C'est la clé de liaison la plus fiable — elle survit à TOUS les
        // mismatches d'email (Apple Pay, alias, casse…).
        const clientReferenceId =
          typeof session.client_reference_id === 'string' && session.client_reference_id.trim()
            ? session.client_reference_id.trim()
            : null
        if (supabaseUrl && serviceKey && payload) {
          // 1) On garde l'enregistrement dans stripe_pending_links comme
          //    filet pour les flux exotiques (paiement direct via lien
          //    partagé sans passer par /signup).
          await recordPendingLink(supabaseUrl, serviceKey, session.id, payload)
          // 2) Tentative de mise à jour directe de la table `users` : par
          //    user.id en priorité (client_reference_id), fallback email.
          await syncSupabaseUserFromPayload(
            supabaseUrl,
            serviceKey,
            payload,
            clientReferenceId,
          )
        } else if (!payload) {
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
}
