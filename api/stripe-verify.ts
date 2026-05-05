import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { retrieveAndBuildCheckoutPayload } from './_lib/stripe-checkout-payload'

// ─── Vérification + sync forcée d'un paiement Stripe ──────────────────────
//
// Endpoint appelé après le redirect Stripe → /paiementreussi?session_id=...
// puis (au besoin) par AppLayout en filet de sécurité quand le webhook
// `checkout.session.completed` met trop de temps à arriver (ou est perdu).
//
// Deux modes :
//
//   (1) GET ou POST sans Authorization → renvoie juste le payload Stripe
//       (utilisé historiquement pour confirmer un paiement côté client).
//
//   (2) POST avec Authorization Bearer <supabase access_token> → en plus
//       de renvoyer le payload, on FORCE la mise à jour de public.users
//       pour le user authentifié, en utilisant le service_role Supabase.
//       Liaison par user.id Supabase (priorité absolue), avec fallback
//       email pour les anciens cas. C'est le filet de sécurité qui rend
//       le flux résistant à un webhook lent ou perdu.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function syncDbForAuthedUser(args: {
  supabaseUrl: string
  serviceKey: string
  authedUserId: string
  authedUserEmail: string | null
  payload: {
    plan: 'weekly' | 'monthly'
    credits: number
    subscription_status: 'active' | 'trialing'
    email: string | null
    customerId: string | null
  }
  clientReferenceId: string | null
}): Promise<{ updated: boolean; reason: string }> {
  const supabase = createClient(args.supabaseUrl, args.serviceKey)
  const row = {
    plan: args.payload.plan,
    credits_remaining: args.payload.credits,
    subscription_status: args.payload.subscription_status,
    stripe_customer_id: args.payload.customerId || null,
    stripe_payment_email: args.payload.email?.trim().toLowerCase() || null,
  }

  // Le client_reference_id sur la session Stripe DOIT correspondre à l'auth
  // user. C'est le critère de confiance — n'importe qui pourrait sinon hit
  // l'endpoint avec un session_id volé pour forcer une sync sur SON compte.
  // Si pas de match strict (legacy paiement avant la refonte par exemple),
  // on accepte tout de même la sync sur l'auth user MAIS uniquement si :
  //   - le Customer Stripe n'est pas déjà lié à un autre compte Supabase
  //   - ou le payment email matche celui du compte
  // Pour rester simple et sûr, on lie systématiquement par auth user.id —
  // c'est le compte de l'utilisateur courant, qui revient juste de Stripe.
  const expectedUserId = args.authedUserId

  if (
    args.clientReferenceId &&
    UUID_REGEX.test(args.clientReferenceId) &&
    args.clientReferenceId !== expectedUserId
  ) {
    // Cas suspect : un session_id Stripe avec un client_reference_id qui
    // pointe vers un AUTRE user Supabase. On refuse de l'associer au user
    // courant (sinon on fait du « hijack » de paiement).
    return { updated: false, reason: 'client_reference_id_mismatch' }
  }

  // Vérif anti-hijack : si stripe_customer_id de ce paiement est DÉJÀ rattaché
  // à un autre user Supabase (autre id), on refuse de le réattribuer.
  if (row.stripe_customer_id) {
    const { data: owners } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_customer_id', row.stripe_customer_id)
    const ids = (owners || []).map((u) => u.id) as string[]
    if (ids.length && ids.some((id) => id !== expectedUserId)) {
      return { updated: false, reason: 'customer_already_linked_to_other_user' }
    }
  }

  // Liaison par user.id (= auth user) : c'est l'endroit le plus fiable.
  const { data: hit, error } = await supabase
    .from('users')
    .update(row)
    .eq('id', expectedUserId)
    .select('id')
  if (error) {
    console.warn('[stripe-verify] sync update error', error.message)
    return { updated: false, reason: 'update_error' }
  }
  if (hit?.length) return { updated: true, reason: 'updated_by_user_id' }

  // La ligne n'existe pas encore (trigger pas exécuté ?) → upsert.
  const { error: upErr } = await supabase
    .from('users')
    .upsert(
      [{
        id: expectedUserId,
        email: (args.authedUserEmail || row.stripe_payment_email || '').toLowerCase(),
        ...row,
      }],
      { onConflict: 'id' },
    )
  if (upErr) {
    console.warn('[stripe-verify] sync upsert error', upErr.message)
    return { updated: false, reason: 'upsert_error' }
  }
  return { updated: true, reason: 'upserted_by_user_id' }
}

async function getAuthedUser(
  supabaseUrl: string,
  anonOrServiceKey: string,
  authHeader: string | undefined,
): Promise<{ id: string; email: string | null } | null> {
  if (!authHeader || typeof authHeader !== 'string') return null
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const token = m[1]
  try {
    const supabase = createClient(supabaseUrl, anonOrServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data } = await supabase.auth.getUser(token)
    if (!data?.user?.id) return null
    return { id: data.user.id, email: data.user.email ?? null }
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY

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

  // Mode mismatch (clé Live ↔ session Test ou inverse).
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
      return res.status(400).json({
        error: 'Plan non reconnu (les Price ID Stripe ne correspondent pas à HEBDO_PRICE_ID / MENSU_PRICE_ID dans Vercel).',
      })
    }

    // ─── Mode (2) : sync forcée DB si le client est authentifié ──────────
    let synced: { updated: boolean; reason: string } | null = null
    const authHeader = req.headers.authorization
    if (authHeader && supabaseUrl && serviceKey) {
      const keyForAuthCheck = anonKey || serviceKey
      const authed = await getAuthedUser(supabaseUrl, keyForAuthCheck, authHeader)
      if (authed) {
        // Récupère le client_reference_id en re-faisant un retrieve « léger »
        // (la session a déjà été récupérée par retrieveAndBuildCheckoutPayload
        // mais on n'avait pas besoin du field — un retrieve supplémentaire est
        // bon marché côté Stripe).
        let clientReferenceId: string | null = null
        try {
          const sessionLite = await stripe.checkout.sessions.retrieve(sessionId)
          clientReferenceId =
            typeof sessionLite.client_reference_id === 'string' && sessionLite.client_reference_id.trim()
              ? sessionLite.client_reference_id.trim()
              : null
        } catch { /* ignore */ }

        synced = await syncDbForAuthedUser({
          supabaseUrl,
          serviceKey,
          authedUserId: authed.id,
          authedUserEmail: authed.email,
          payload,
          clientReferenceId,
        })
      }
    }

    return res.status(200).json({
      plan: payload.plan,
      credits: payload.credits,
      email: payload.email,
      customerId: payload.customerId,
      subscription_status: payload.subscription_status,
      synced: synced?.updated ?? false,
      sync_reason: synced?.reason ?? null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-verify] error', msg)
    return res.status(500).json({ error: msg || 'Vérification Stripe impossible' })
  }
}
