import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { retrieveAndBuildCheckoutPayload } from './_lib/stripe-checkout-payload'

/**
 * Normalise `req.body` côté Vercel : selon runtime / Content-Type, la POST
 * peut arriver comme objet déjà parsé, chaîne JSON brute, ou Buffer.
 * Sans ça, `action: 'claim'` et `email` sont parfois invisibles → la requête
 * ne déclenche pas le mode claim (symptôme côté client : parsing JSON KO ou
 * erreur générique « réponse serveur invalide »).
 */
function normalizePostBody(req: VercelRequest): Record<string, unknown> {
  try {
    const raw = req.body as unknown
    if (raw == null || raw === '') return {}
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
        return {}
      } catch {
        return {}
      }
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
      try {
        const parsed = JSON.parse(raw.toString('utf8')) as unknown
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
        return {}
      } catch {
        return {}
      }
    }
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      return raw as Record<string, unknown>
    }
    return {}
  } catch (e) {
    console.warn('[stripe-verify] normalizePostBody', e)
    return {}
  }
}

/** Toujours renvoyer du JSON — évite les 500 « corps vide » côté Vercel. */
function sendJson(res: VercelResponse, status: number, payload: Record<string, unknown>) {
  try {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').json(payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[stripe-verify] sendJson serialization failure', msg)
    res
      .status(500)
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .json({ ok: false, reason: 'server_error', error: 'Erreur interne de sérialisation.' })
  }
}

// ─── Vérification + sync forcée d'un paiement Stripe ──────────────────────
//
// Endpoint appelé après le redirect Stripe → /paiementreussi?session_id=...
// puis (au besoin) par AppLayout en filet de sécurité quand le webhook
// `checkout.session.completed` met trop de temps à arriver (ou est perdu).
//
// Trois modes :
//
//   (1) GET ou POST sans Authorization, avec session_id → renvoie juste
//       le payload Stripe (utilisé historiquement pour confirmer un
//       paiement côté client).
//
//   (2) POST avec Authorization Bearer <supabase access_token> et
//       session_id → en plus de renvoyer le payload, on FORCE la mise à
//       jour de public.users pour le user authentifié (filet de sécurité
//       webhook lent / perdu).
//
//   (3) POST avec Authorization Bearer + body { action: "claim", email }
//       → recherche un Customer Stripe par email avec un abo actif/trial
//       et le rattache au user Supabase courant. Sert à récupérer un
//       compte d'avant la refonte 2026-05-05 (paiement réalisé alors que
//       le compte Supabase n'existait pas, ou existait sous un autre
//       email). Anti-hijack : refuse si le Customer est déjà lié à un
//       autre user Supabase.

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

const PLAN_CREDITS = { weekly: 160, monthly: 560 } as const

function planFromPriceAmount(amountCents: number | null | undefined): 'weekly' | 'monthly' {
  const ref = amountCents ?? 0
  if (Math.abs(ref - 299) <= 5) return 'weekly'
  if (Math.abs(ref - 990) <= 5) return 'monthly'
  if (ref > 0 && ref < 500) return 'weekly'
  return 'monthly'
}

/**
 * Mode (3) : claim. Le user authentifié donne un email avec lequel il a
 * payé sur Stripe (Apple Pay, alias, ancien email…). On cherche le
 * Customer côté Stripe, on vérifie qu'il a un abo actif/trialing, qu'il
 * n'est pas déjà lié à un autre user Supabase, puis on rattache.
 */
async function handleClaim(
  stripe: Stripe,
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string | undefined,
  authHeader: string | undefined,
  rawEmail: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const keyForAuthCheck = anonKey || serviceKey
  const authed = await getAuthedUser(supabaseUrl, keyForAuthCheck, authHeader)
  if (!authed) {
    return { status: 401, body: { ok: false, reason: 'unauthorized', error: 'Connexion requise pour récupérer un abonnement.' } }
  }
  const email = (rawEmail || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, body: { ok: false, reason: 'invalid_email', error: 'Email invalide.' } }
  }

  // 1. Recherche les Customers Stripe par email (case-insensitive).
  let customers: Stripe.Customer[] = []
  try {
    const list = await stripe.customers.list({ email, limit: 100 })
    customers = list.data
    // Stripe ne fait pas toujours du case-insensitive : on retest manuellement
    const localPart = email.split('@')[0]
    const domain = email.split('@')[1]
    if (!customers.length && localPart && domain) {
      // Tente la version « originale » (capitalisée par exemple).
      // Stripe normalize l'email en interne pour les Customers récents,
      // donc en pratique cet appel suffit pour la majorité des cas.
    }
  } catch (e) {
    console.error('[stripe-verify/claim] customers.list error', e)
    return { status: 500, body: { ok: false, reason: 'server_error', error: 'Recherche Stripe impossible.' } }
  }
  if (!customers.length) {
    return { status: 404, body: { ok: false, reason: 'no_customer', error: "Aucun client Stripe trouvé avec cet email. Vérifie qu'il s'agit bien de l'email utilisé pour le paiement." } }
  }

  // 2. Pour chaque customer, liste les subscriptions et garde la plus récente
  //    qui est encore active/trialing/cancel-at-period-end.
  type Match = {
    customer: Stripe.Customer
    subscription: Stripe.Subscription
    plan: 'weekly' | 'monthly'
    subscription_status: 'active' | 'trialing' | 'cancelled'
  }
  const matches: Match[] = []
  for (const c of customers) {
    let subs: Stripe.Subscription[] = []
    try {
      // Pas d'`expand` ici : certains comptes / versions API Stripe renvoient
      // une erreur sur des chemins expand mal supportés → exception globale si
      // mal gérée. Sans expand, price peut être une string id ; planFromPriceAmount
      // retombe alors sur la valeur par défaut (mensuel), ce qui suffit pour le claim.
      const r = await stripe.subscriptions.list({
        customer: c.id,
        status: 'all',
        limit: 10,
      })
      subs = r.data
    } catch (e) {
      console.warn('[stripe-verify/claim] subscriptions.list error for', c.id, e)
      continue
    }
    for (const s of subs) {
      const status = s.status
      const ok =
        status === 'active' ||
        status === 'trialing' ||
        // canceled mais accès jusqu'à fin de période :
        (status === 'canceled' && (s as unknown as { current_period_end?: number }).current_period_end &&
          (s as unknown as { current_period_end: number }).current_period_end * 1000 > Date.now())
      if (!ok) continue
      const item = s.items?.data?.[0]
      const amount = item?.price?.unit_amount ?? null
      const plan = planFromPriceAmount(amount)
      const subscription_status: Match['subscription_status'] =
        status === 'trialing' ? 'trialing' : status === 'canceled' ? 'cancelled' : 'active'
      matches.push({ customer: c, subscription: s, plan, subscription_status })
    }
  }
  if (!matches.length) {
    return { status: 404, body: { ok: false, reason: 'no_active_sub', error: "Aucun abonnement actif trouvé pour cet email." } }
  }

  // Prend le match avec la subscription la plus récente.
  matches.sort((a, b) => (b.subscription.created || 0) - (a.subscription.created || 0))
  const best = matches[0]

  // 3. Anti-hijack : ce Customer Stripe est-il déjà lié à un autre user ?
  const supabase = createClient(supabaseUrl, serviceKey)
  const customerId = best.customer.id
  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_customer_id', customerId)
    const ids = (existing || []).map((u) => u.id) as string[]
    if (ids.length && ids.some((id) => id !== authed.id)) {
      return { status: 409, body: { ok: false, reason: 'already_linked', error: "Ce client Stripe est déjà associé à un autre compte. Contacte le support." } }
    }
  } catch (e) {
    console.warn('[stripe-verify/claim] users.select error', e)
  }
  // Anti-hijack #2 : la metadata Stripe Customer a-t-elle déjà un
  // supabase_user_id qui pointe vers un AUTRE user ?
  const meta = (best.customer.metadata || {}) as Record<string, string>
  if (meta.supabase_user_id && meta.supabase_user_id !== authed.id) {
    return { status: 409, body: { ok: false, reason: 'already_linked_metadata', error: "Ce client Stripe est déjà associé à un autre compte. Contacte le support." } }
  }

  // 4. OK → on lie. Update users (par auth user.id), upsert si besoin.
  const credits = PLAN_CREDITS[best.plan]
  const stripeEmail = (best.customer.email || email).toLowerCase()
  const row = {
    plan: best.plan,
    credits_remaining: credits,
    subscription_status: best.subscription_status,
    stripe_customer_id: customerId,
    stripe_payment_email: stripeEmail,
  }
  let updated = false
  try {
    const { data: hit, error } = await supabase
      .from('users')
      .update(row)
      .eq('id', authed.id)
      .select('id')
    if (!error && hit?.length) updated = true
    if (!updated) {
      // Pas de ligne → upsert (créé par le trigger normalement, mais filet)
      const { error: upErr } = await supabase
        .from('users')
        .upsert(
          [{ id: authed.id, email: (authed.email || stripeEmail).toLowerCase(), ...row }],
          { onConflict: 'id' },
        )
      if (!upErr) updated = true
    }
  } catch (e) {
    console.error('[stripe-verify/claim] update/upsert error', e)
  }
  if (!updated) {
    return { status: 500, body: { ok: false, reason: 'server_error', error: 'Liaison impossible (erreur Supabase).' } }
  }

  // 5. Verrouille la liaison côté Stripe : on inscrit supabase_user_id
  //    dans la metadata du Customer pour qu'aucun autre user ne puisse
  //    le claim plus tard.
  try {
    await stripe.customers.update(customerId, {
      metadata: {
        ...meta,
        supabase_user_id: authed.id,
        supabase_email: (authed.email || '').toLowerCase(),
      },
    })
  } catch (e) {
    console.warn('[stripe-verify/claim] customer metadata update warning', e)
  }

  return {
    status: 200,
    body: {
      ok: true,
      plan: best.plan,
      credits,
      subscription_status: best.subscription_status,
      customerId,
      paymentEmail: stripeEmail,
    },
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY
    // Variables sans préfixe VITE_ : disponibles sur plus de configs Vercel
    // pour les fonctions server-only (évite SUPABASE_URL vide → crash avant json).
    const supabaseUrl =
      (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim() || ''
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || ''
    const anonKey =
      (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim() ||
      undefined

    if (!stripeSecret) {
      console.error('[stripe-verify] STRIPE_SECRET_KEY manquant dans Vercel')
      return sendJson(res, 500, {
        ok: false,
        reason: 'server_error',
        error: 'Configuration serveur : STRIPE_SECRET_KEY manquant sur Vercel.',
      })
    }

    const postBody = req.method === 'POST' ? normalizePostBody(req) : {}
    const qAction = typeof req.query.action === 'string' ? req.query.action.trim().toLowerCase() : ''
    const bodyAction =
      typeof postBody.action === 'string' ? postBody.action.trim().toLowerCase() : ''
    const action = qAction || bodyAction || ''

    // ─── Mode (3) : claim — récupérer un abo Stripe par email ───────────────
    if (action === 'claim') {
      try {
        if (!supabaseUrl || !serviceKey) {
          return sendJson(res, 500, {
            ok: false,
            reason: 'server_error',
            error:
              'Configuration Supabase incomplète sur le serveur. Ajoute SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (et optionnel SUPABASE_ANON_KEY) dans les variables Vercel — pas seulement les variables VITE_*.',
          })
        }
        const emailRaw =
          (typeof postBody.email === 'string' ? postBody.email : '') ||
          (typeof req.query.email === 'string' ? req.query.email : '') ||
          ''
        let stripe: Stripe
        try {
          stripe = new Stripe(stripeSecret)
        } catch (se) {
          const m = se instanceof Error ? se.message : String(se)
          console.error('[stripe-verify] Stripe SDK init', m)
          return sendJson(res, 500, {
            ok: false,
            reason: 'server_error',
            error: `Clé Stripe invalide ou SDK : ${m}`,
          })
        }
        const result = await handleClaim(
          stripe,
          supabaseUrl,
          serviceKey,
          anonKey,
          req.headers.authorization,
          emailRaw,
        )
        return sendJson(res, result.status, result.body)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[stripe-verify] claim fatal', msg)
        return sendJson(res, 500, {
          ok: false,
          reason: 'server_error',
          error: msg || 'Erreur serveur inattendue pendant la récupération.',
        })
      }
    }

    // ─── Modes (1) et (2) : verify avec session_id ──────────────────────────
    const sessionId =
      (typeof req.query.session_id === 'string' ? req.query.session_id : '') ||
      (typeof postBody.session_id === 'string' ? postBody.session_id : '') ||
      ''

    if (!sessionId || typeof sessionId !== 'string') {
      return sendJson(res, 400, { error: 'session_id manquant' })
    }

    const isLiveKey = stripeSecret.startsWith('sk_live_')
    const isLiveSession = sessionId.startsWith('cs_live_')
    const isTestSession = sessionId.startsWith('cs_test_')
    if (isLiveKey && isTestSession) {
      console.error('[stripe-verify] mode mismatch : clé LIVE, session TEST', { sessionId })
      return sendJson(res, 400, {
        error:
          'Mode Stripe incompatible : clé LIVE mais session TEST.',
      })
    }
    if (!isLiveKey && isLiveSession) {
      console.error('[stripe-verify] mode mismatch : clé TEST, session LIVE', { sessionId })
      return sendJson(res, 400, {
        error:
          'Mode Stripe incompatible : clé TEST mais session LIVE.',
      })
    }

    const stripe = new Stripe(stripeSecret)
    const payload = await retrieveAndBuildCheckoutPayload(stripe, sessionId)
    if (!payload) {
      let session: Stripe.Checkout.Session
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[stripe-verify] retrieve échoué', msg, { sessionId })
        return sendJson(res, 404, {
          error: `Session Stripe introuvable : ${msg}`,
        })
      }
      const paidLike =
        session.payment_status === 'paid' ||
        session.payment_status === 'no_payment_required'
      if (session.status !== 'complete' || !paidLike) {
        return sendJson(res, 402, {
          error: 'Paiement non finalisé côté Stripe',
          payment_status: session.payment_status,
          status: session.status,
        })
      }
      return sendJson(res, 400, {
        error:
          'Plan non reconnu (Price ID ou montants Stripe vs variables Vercel).',
      })
    }

    let synced: { updated: boolean; reason: string } | null = null
    const authHeader = req.headers.authorization
    if (authHeader && supabaseUrl && serviceKey) {
      const keyForAuthCheck = anonKey || serviceKey
      const authed = await getAuthedUser(supabaseUrl, keyForAuthCheck, authHeader)
      if (authed) {
        let clientReferenceId: string | null = null
        try {
          const sessionLite = await stripe.checkout.sessions.retrieve(sessionId)
          clientReferenceId =
            typeof sessionLite.client_reference_id === 'string' && sessionLite.client_reference_id.trim()
              ? sessionLite.client_reference_id.trim()
              : null
        } catch {
          /* ignore */
        }

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

    return sendJson(res, 200, {
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
    console.error('[stripe-verify] fatal', msg)
    return sendJson(res, 500, {
      ok: false,
      reason: 'server_error',
      error: msg || 'Erreur serveur Stripe.',
    })
  }
}
