import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { retrieveAndBuildCheckoutPayload } from './_lib/stripe-checkout-payload'

// ─── Vérification serveur d'un paiement Stripe ────────────────────────────────
//
// Endpoint appelé après le redirect Stripe → /paiementreussi?session_id=...
// Retourne le plan réellement payé (weekly/monthly) en interrogeant Stripe.
//
// Logs explicites côté serveur (Vercel → Logs) pour pouvoir tracer un paiement
// qui ne se finalise pas : c'est la première chose à regarder en prod.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY
  if (!stripeSecret) {
    console.error('[stripe-verify] STRIPE_SECRET_KEY manquant dans Vercel')
    return res.status(500).json({
      error: 'Configuration serveur incomplète : STRIPE_SECRET_KEY manquant côté Vercel.',
    })
  }

  const sessionId =
    (req.query.session_id as string | undefined) ||
    (req.body && (req.body as { session_id?: string }).session_id) ||
    ''

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'session_id manquant' })
  }

  // Détection prématurée : clé Live ↔ session Test (ou inverse) → message clair
  const isLiveKey = stripeSecret.startsWith('sk_live_')
  const isLiveSession = sessionId.startsWith('cs_live_')
  const isTestSession = sessionId.startsWith('cs_test_')
  if (isLiveKey && isTestSession) {
    console.error('[stripe-verify] mode mismatch : clé LIVE, session TEST', { sessionId })
    return res.status(400).json({
      error: 'Mode Stripe incompatible : ta clé sur Vercel est en LIVE mais cette session est en TEST. Recharge un lien de paiement Live ou bascule la clé.',
    })
  }
  if (!isLiveKey && isLiveSession) {
    console.error('[stripe-verify] mode mismatch : clé TEST, session LIVE', { sessionId })
    return res.status(400).json({
      error: 'Mode Stripe incompatible : ta clé sur Vercel est en TEST mais ce paiement est en LIVE. Mets STRIPE_SECRET_KEY en LIVE sur Vercel.',
    })
  }

  try {
    const stripe = new Stripe(stripeSecret)
    const payload = await retrieveAndBuildCheckoutPayload(stripe, sessionId)
    if (!payload) {
      let session: Stripe.Checkout.Session
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[stripe-verify] retrieve échoué', msg, { sessionId })
        return res.status(404).json({
          error: `Session Stripe introuvable : ${msg}`,
        })
      }
      const paidLike =
        session.payment_status === 'paid' ||
        session.payment_status === 'no_payment_required'
      if (session.status !== 'complete' || !paidLike) {
        return res.status(402).json({
          error: 'Paiement non finalisé côté Stripe',
          payment_status: session.payment_status,
          status: session.status,
        })
      }
      // Paiement OK mais price.id non reconnu → variables d'env Vercel à corriger.
      return res.status(400).json({
        error: 'Plan non reconnu (les Price ID Stripe ne correspondent pas à HEBDO_PRICE_ID / MENSU_PRICE_ID dans Vercel).',
      })
    }

    return res.status(200).json({
      plan: payload.plan,
      credits: payload.credits,
      email: payload.email,
      customerId: payload.customerId,
      subscription_status: payload.subscription_status,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-verify] error', msg)
    return res.status(500).json({ error: msg || 'Vérification Stripe impossible' })
  }
}
