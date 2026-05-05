import type { VercelRequest, VercelResponse } from '@vercel/node'
import type StripeType from 'stripe'

// ─── Imports lourds en DYNAMIC : si le SDK Stripe ou Supabase plantent
// au chargement, le mode `?action=diag` doit pouvoir quand même répondre
// pour permettre le diagnostic.

/**
 * Diagnostic des variables d'env Vercel — appelé via ?action=diag.
 * Ne révèle JAMAIS de valeur, uniquement présent/absent + longueur + format.
 */
function buildDiag(): Record<string, unknown> {
  const vars = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    VITE_KIE_API_KEY: process.env.VITE_KIE_API_KEY,
    HEBDO_PRICE_ID: process.env.HEBDO_PRICE_ID,
    MENSU_PRICE_ID: process.env.MENSU_PRICE_ID,
  }
  const summary: Record<string, { present: boolean; length: number; hint?: string }> = {}
  for (const [key, val] of Object.entries(vars)) {
    const trimmed = (val || '').trim()
    const entry: { present: boolean; length: number; hint?: string } = {
      present: trimmed.length > 0,
      length: trimmed.length,
    }
    if (trimmed.length > 0) {
      if (key === 'STRIPE_SECRET_KEY') {
        entry.hint = trimmed.startsWith('sk_live_')
          ? 'OK live'
          : trimmed.startsWith('sk_test_')
          ? 'mode TEST'
          : 'format inattendu'
      } else if (key === 'STRIPE_WEBHOOK_SECRET') {
        entry.hint = trimmed.startsWith('whsec_') ? 'OK' : 'devrait commencer par whsec_'
      } else if (key === 'SUPABASE_URL' || key === 'VITE_SUPABASE_URL') {
        entry.hint =
          trimmed.startsWith('https://') && trimmed.endsWith('.supabase.co')
            ? 'OK'
            : 'format inattendu'
      }
    }
    summary[key] = entry
  }
  const missingCritical: string[] = []
  if (!summary.STRIPE_SECRET_KEY.present) missingCritical.push('STRIPE_SECRET_KEY')
  if (!summary.STRIPE_WEBHOOK_SECRET.present) missingCritical.push('STRIPE_WEBHOOK_SECRET')
  if (!summary.SUPABASE_URL.present && !summary.VITE_SUPABASE_URL.present) {
    missingCritical.push('SUPABASE_URL (ou VITE_SUPABASE_URL)')
  }
  if (!summary.SUPABASE_SERVICE_ROLE_KEY.present) {
    missingCritical.push('SUPABASE_SERVICE_ROLE_KEY')
  }
  return {
    ok: missingCritical.length === 0,
    missingCritical,
    summary,
    nodeVersion: process.version,
    help:
      missingCritical.length === 0
        ? 'Toutes les variables critiques sont présentes.'
        : 'Ajoute les variables manquantes sur Vercel → Settings → Environment Variables, puis redéploie.',
  }
}

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

function sendJson(res: VercelResponse, status: number, payload: Record<string, unknown>) {
  try {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').json(payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[stripe-verify] sendJson serialization failure', msg)
    res
      .status(500)
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .json({ ok: false, reason: 'server_error', error: 'Erreur sérialisation.' })
  }
}

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
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(args.supabaseUrl, args.serviceKey)
  const row = {
    plan: args.payload.plan,
    credits_remaining: args.payload.credits,
    subscription_status: args.payload.subscription_status,
    stripe_customer_id: args.payload.customerId || null,
    stripe_payment_email: args.payload.email?.trim().toLowerCase() || null,
  }

  const expectedUserId = args.authedUserId

  if (
    args.clientReferenceId &&
    UUID_REGEX.test(args.clientReferenceId) &&
    args.clientReferenceId !== expectedUserId
  ) {
    return { updated: false, reason: 'client_reference_id_mismatch' }
  }

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
    const { createClient } = await import('@supabase/supabase-js')
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
  // Wrap absolu : aucune exception ne doit faire passer Vercel en
  // FUNCTION_INVOCATION_FAILED. Le mode diag DOIT toujours répondre.
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    // ─── Lecture des params SANS aucun import lourd ─────────────────────
    let postBody: Record<string, unknown> = {}
    try {
      postBody = req.method === 'POST' ? normalizePostBody(req) : {}
    } catch { /* ignore */ }
    const qAction = typeof req.query.action === 'string' ? req.query.action.trim().toLowerCase() : ''
    const bodyAction =
      typeof postBody.action === 'string' ? postBody.action.trim().toLowerCase() : ''
    const action = qAction || bodyAction || ''

    // ─── Mode diagnostic : avant TOUT chargement de SDK ─────────────────
    if (action === 'diag') {
      try {
        return sendJson(res, 200, buildDiag())
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        return sendJson(res, 500, { ok: false, error: `diag failed: ${m}` })
      }
    }

    const stripeSecret = (process.env.STRIPE_SECRET_KEY || '').trim()
    const supabaseUrl =
      (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim() || ''
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || ''
    const anonKey =
      (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim() ||
      undefined

    if (!stripeSecret) {
      return sendJson(res, 500, {
        ok: false,
        reason: 'server_error',
        error: 'STRIPE_SECRET_KEY manquant sur Vercel.',
      })
    }

    // ─── Verify avec session_id ──────────────────────────────────────────
    const sessionId =
      (typeof req.query.session_id === 'string' ? req.query.session_id : '') ||
      (typeof postBody.session_id === 'string' ? postBody.session_id : '') ||
      ''

    if (!sessionId) {
      return sendJson(res, 400, { error: 'session_id manquant' })
    }

    const isLiveKey = stripeSecret.startsWith('sk_live_')
    const isLiveSession = sessionId.startsWith('cs_live_')
    const isTestSession = sessionId.startsWith('cs_test_')
    if (isLiveKey && isTestSession) {
      return sendJson(res, 400, { error: 'Mode Stripe incompatible : clé LIVE mais session TEST.' })
    }
    if (!isLiveKey && isLiveSession) {
      return sendJson(res, 400, { error: 'Mode Stripe incompatible : clé TEST mais session LIVE.' })
    }

    // ─── Imports dynamiques : Stripe SDK + helpers ──────────────────────
    let Stripe: typeof StripeType
    try {
      const m = await import('stripe')
      Stripe = m.default
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return sendJson(res, 500, { ok: false, error: `Stripe SDK import: ${msg}` })
    }

    let retrieveAndBuildCheckoutPayload: typeof import('./_lib/stripe-checkout-payload').retrieveAndBuildCheckoutPayload
    try {
      const helper = await import('./_lib/stripe-checkout-payload')
      retrieveAndBuildCheckoutPayload = helper.retrieveAndBuildCheckoutPayload
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return sendJson(res, 500, { ok: false, error: `Helper import: ${msg}` })
    }

    let stripe: StripeType
    try {
      stripe = new Stripe(stripeSecret)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return sendJson(res, 500, { ok: false, error: `Stripe SDK init: ${msg}` })
    }

    const payload = await retrieveAndBuildCheckoutPayload(stripe, sessionId)
    if (!payload) {
      let session: StripeType.Checkout.Session
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return sendJson(res, 404, { error: `Session Stripe introuvable : ${msg}` })
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
        error: 'Plan non reconnu (Price ID ou montants Stripe vs variables Vercel).',
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

    return sendJson(res, 200, {
      plan: payload.plan,
      credits: payload.credits,
      email: payload.email,
      customerId: payload.customerId,
      subscription_status: payload.subscription_status,
      synced: synced?.updated ?? false,
      sync_reason: synced?.reason ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    console.error('[stripe-verify] FATAL:', msg, stack)
    try {
      return sendJson(res, 500, { ok: false, error: `Webhook fatal: ${msg}` })
    } catch {
      return res.status(500).end(`stripe-verify fatal: ${msg}`)
    }
  }
}
