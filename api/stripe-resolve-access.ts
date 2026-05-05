import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { retrieveAndBuildCheckoutPayload } from './_lib/stripe-checkout-payload'

// ─── Endpoint « rattrapage d'accès payant » ──────────────────────────────────
//
// Source de vérité = Stripe. Le frontend appelle cet endpoint quand la table
// `users` Supabase n'indique pas d'abonnement actif, AVANT d'éjecter le client
// vers /login. Cas couverts :
//
//   1. Le webhook `checkout.session.completed` n'est jamais arrivé (panne
//      Vercel, signature invalide, etc.) → la DB n'a jamais été mise à jour.
//   2. Le webhook a été reçu AVANT que le user crée son compte côté Supabase
//      (paiement → création compte) — à cet instant le user n'existait pas
//      encore, mais on l'a stocké dans `stripe_pending_links` pour le
//      rattraper ici.
//   3. L'email du compte GoMytho ≠ email du paiement (Apple Pay, Google Pay,
//      Revolut Pay, alias Gmail+xxx, casse différente). L'utilisateur ne
//      pourra jamais être retrouvé via une simple lecture DB sur `email`.
//   4. Le persistUserProfile post-signup a échoué silencieusement (RLS,
//      réseau, race condition) — la DB est restée en `plan='free'`.
//   5. Cross-device : le client a payé sur téléphone, s'inscrit/se connecte
//      sur PC. Le session_id en localStorage n'est pas dispo, mais le
//      webhook a posé l'info dans `stripe_pending_links` (côté serveur,
//      survit à tout).
//
// Stratégie en cascade (du plus précis au plus large) :
//   a) `session_id` fourni → liaison forcée Customer Stripe ↔ user Supabase.
//   b) Lookup `stripe_pending_links` par email (du compte ou de paiement).
//   c) `stripe_customer_id` déjà persisté en DB → retrieve direct.
//   d) `customers.list({ email })` puis `customers.search` sur emails
//      candidats (paiement + compte).
//   e) Dernier recours : balayage `subscriptions.list` avec match d'email.
//
// Si on trouve un Customer avec ≥1 subscription en `active`/`trialing` :
// on synchronise la table `users` (plan, credits, customer_id, payment_email)
// avec la clé service_role, et on marque le pending_link comme « consommé ».
// Le frontend peut alors laisser passer le user sans le rebalancer vers
// /choixoffre.

export const config = {
  maxDuration: 20,
}

const PLAN_CREDITS: Record<'weekly' | 'monthly', number> = {
  weekly: 160,
  monthly: 560,
}
const CREDITS_PER_IMAGE = 8
const MONTHLY_TRIAL_CREDITS = CREDITS_PER_IMAGE

const HEBDO_PRICE_ID = (process.env.HEBDO_PRICE_ID || '').trim()
const MENSU_PRICE_ID = (process.env.MENSU_PRICE_ID || '').trim()
const HEBDO_AMOUNT_CENTS = 299
const MENSU_AMOUNT_CENTS = 990

type Plan = 'weekly' | 'monthly'
type SubStatus = 'active' | 'trialing' | 'cancelled' | 'inactive'

function planFromPriceId(priceId: string | undefined | null): Plan | null {
  if (!priceId) return null
  if (HEBDO_PRICE_ID && priceId === HEBDO_PRICE_ID) return 'weekly'
  if (MENSU_PRICE_ID && priceId === MENSU_PRICE_ID) return 'monthly'
  return null
}

function planFromAmount(unitAmount: number | null | undefined): Plan {
  const reference = unitAmount ?? 0
  if (Math.abs(reference - HEBDO_AMOUNT_CENTS) <= 5) return 'weekly'
  if (Math.abs(reference - MENSU_AMOUNT_CENTS) <= 5) return 'monthly'
  if (reference > 0 && reference < 500) return 'weekly'
  return 'monthly'
}

function planFromSubscription(sub: Stripe.Subscription): Plan {
  const item = sub.items?.data?.[0]
  const priceId = (item?.price?.id as string | undefined) || null
  const fromId = planFromPriceId(priceId)
  if (fromId) return fromId
  const unitAmount = (item?.price?.unit_amount as number | undefined) ?? null
  return planFromAmount(unitAmount)
}

function isPaidStatus(status: Stripe.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due'
}

function getBearer(req: VercelRequest): string | null {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : null
}

async function findCustomerIdByEmails(
  stripe: Stripe,
  emails: string[],
): Promise<string | null> {
  for (const candidate of emails) {
    if (!candidate) continue
    try {
      const list = await stripe.customers.list({ email: candidate, limit: 10 })
      if (list.data[0]?.id) return list.data[0].id
    } catch (e) {
      console.warn('[stripe-resolve-access] customers.list KO:', (e as Error)?.message)
    }
  }
  for (const candidate of emails) {
    if (!candidate) continue
    try {
      const search = await stripe.customers.search({
        query: `email:'${candidate.replace(/'/g, "\\'")}'`,
        limit: 10,
      })
      if (search.data[0]?.id) return search.data[0].id
    } catch (e) {
      console.warn('[stripe-resolve-access] customers.search KO:', (e as Error)?.message)
    }
  }
  // Dernier recours : on balaye les subscriptions actives + on matche l'email
  // côté customer expandé. Plus coûteux mais on n'arrive ici que si les deux
  // recherches au-dessus ont rien donné.
  try {
    const subs = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      expand: ['data.customer'],
    })
    const lower = emails.map((e) => e.toLowerCase()).filter(Boolean)
    const match = subs.data.find((s) => {
      const cust = s.customer as Stripe.Customer | string
      if (!cust || typeof cust === 'string') return false
      const email = (cust.email || '').trim().toLowerCase()
      return lower.includes(email)
    })
    if (match) {
      const cust = match.customer as Stripe.Customer
      return cust.id
    }
  } catch (e) {
    console.warn('[stripe-resolve-access] subscriptions.list KO:', (e as Error)?.message)
  }
  return null
}

async function findActiveSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    })
    const activeOrTrial = subs.data.find((s) => isPaidStatus(s.status))
    return activeOrTrial || null
  } catch (e) {
    console.warn('[stripe-resolve-access] subs by customer KO:', (e as Error)?.message)
    return null
  }
}

type PendingLinkRow = {
  session_id: string
  customer_id: string
  stripe_email: string | null
  plan: 'weekly' | 'monthly'
  credits: number
  subscription_status: 'active' | 'trialing'
  consumed_at: string | null
}

/**
 * Cherche un pending_link non consommé qui correspond à l'utilisateur courant.
 * Stratégie : par email (paiement + compte) → on prend le plus récent non
 * consommé. Permet de récupérer un paiement qui n'a jamais réussi à être lié
 * via le flux signup (cross-device, webhook avant signup, etc.).
 */
async function findPendingLinkForUser(
  adminClient: ReturnType<typeof createClient>,
  emails: string[],
): Promise<PendingLinkRow | null> {
  const lowerEmails = Array.from(
    new Set(
      emails.map((e) => (e || '').trim().toLowerCase()).filter((e) => e.length > 0),
    ),
  )
  if (lowerEmails.length === 0) return null

  try {
    // PostgREST `in` accepte une liste — on filtre côté serveur sur stripe_email.
    const { data, error } = await adminClient
      .from('stripe_pending_links')
      .select('session_id, customer_id, stripe_email, plan, credits, subscription_status, consumed_at')
      .is('consumed_at', null)
      .in('stripe_email', lowerEmails)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) {
      console.warn('[stripe-resolve-access] pending_links query error:', error.message)
      return null
    }
    return (data?.[0] as PendingLinkRow | undefined) || null
  } catch (e) {
    console.warn('[stripe-resolve-access] pending_links exception:', (e as Error)?.message)
    return null
  }
}

async function markPendingLinkConsumed(
  adminClient: ReturnType<typeof createClient>,
  sessionId: string,
  userId: string,
) {
  try {
    await adminClient
      .from('stripe_pending_links')
      .update({ consumed_at: new Date().toISOString(), consumed_by_user_id: userId })
      .eq('session_id', sessionId)
  } catch (e) {
    console.warn(
      '[stripe-resolve-access] mark consumed KO (non bloquant):',
      (e as Error)?.message,
    )
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const stripeSecret = process.env.STRIPE_SECRET_KEY

  if (!supabaseUrl || !anonKey || !stripeSecret) {
    console.error('[stripe-resolve-access] env manquantes', {
      hasSupabaseUrl: !!supabaseUrl,
      hasAnon: !!anonKey,
      hasStripe: !!stripeSecret,
    })
    return res.status(500).json({ error: 'Configuration serveur incomplète' })
  }

  const token = getBearer(req)
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  // Optionnel : session_id Stripe que le client peut nous repasser depuis
  // l'URL ou son localStorage. C'est la clé de liaison la plus FIABLE quand
  // les emails diffèrent (Revolut Pay, Apple Pay, alias, casse), parce que le
  // session_id contient TOUJOURS le couple (customer_id, email) côté Stripe.
  let sessionIdHint: string | null = null
  try {
    const fromQuery =
      typeof req.query?.session_id === 'string' ? req.query.session_id : null
    const fromBody =
      req.body && typeof (req.body as { session_id?: string }).session_id === 'string'
        ? (req.body as { session_id: string }).session_id
        : null
    const candidate = (fromQuery || fromBody || '').trim()
    if (candidate && /^cs_(live|test)_[A-Za-z0-9]+$/.test(candidate)) {
      sessionIdHint = candidate
    }
  } catch { /* ignore */ }

  try {
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: authData, error: authErr } = await authClient.auth.getUser(token)
    if (authErr || !authData.user) {
      return res.status(401).json({ error: 'Invalid session' })
    }
    const userId = authData.user.id
    const userEmail = (authData.user.email || '').trim().toLowerCase()

    const adminClient = serviceKey ? createClient(supabaseUrl, serviceKey) : null

    // ─── 1. Lecture DB : peut-être que tout est déjà en règle ────────────────
    let dbProfile: {
      plan?: string | null
      subscription_status?: string | null
      credits_remaining?: number | null
      stripe_customer_id?: string | null
      stripe_payment_email?: string | null
      email?: string | null
    } | null = null
    if (adminClient) {
      const { data } = await adminClient
        .from('users')
        .select('plan, subscription_status, credits_remaining, stripe_customer_id, stripe_payment_email, email')
        .eq('id', userId)
        .maybeSingle()
      dbProfile = data || null
    }

    const stripe = new Stripe(stripeSecret)

    // ─── 2. SHORTCUT ABSOLU : si on a un session_id Stripe, on l'utilise ─────
    // Le session_id Stripe contient toujours le couple (customer_id, email).
    // Aucun match d'email côté DB n'est nécessaire — on lie le Customer Stripe
    // au user Supabase courant DIRECTEMENT, peu importe que les emails
    // diffèrent (Apple Pay, Google Pay, Revolut Pay, alias, casse, …).
    if (sessionIdHint) {
      try {
        const payload = await retrieveAndBuildCheckoutPayload(stripe, sessionIdHint)
        if (payload) {
          const linkedCustomerId = (payload.customerId || '').trim() || null
          const linkedEmail = (payload.email || '').trim().toLowerCase() || null
          const credits = payload.credits
          const plan = payload.plan
          const subscription_status = payload.subscription_status as SubStatus

          if (linkedCustomerId && adminClient) {
            try {
              const updates: Record<string, unknown> = {
                plan,
                subscription_status,
                credits_remaining:
                  // on ne diminue jamais un solde existant si le plan correspond
                  dbProfile?.plan === plan &&
                  typeof dbProfile?.credits_remaining === 'number' &&
                  dbProfile.credits_remaining > credits
                    ? dbProfile.credits_remaining
                    : credits,
                stripe_customer_id: linkedCustomerId,
              }
              if (linkedEmail) updates.stripe_payment_email = linkedEmail
              await adminClient.from('users').update(updates).eq('id', userId)
            } catch (e) {
              console.warn(
                '[stripe-resolve-access] session_id link DB sync KO:',
                (e as Error)?.message,
              )
            }
          }

          if (linkedCustomerId) {
            return res.status(200).json({
              ok: true,
              plan,
              credits,
              subscription_status,
              customerId: linkedCustomerId,
              paymentEmail: linkedEmail,
              reason: 'session_id_link',
            })
          }
        }
      } catch (e) {
        // session_id invalide / expiré → on retombe sur la stratégie email.
        console.warn(
          '[stripe-resolve-access] session_id retrieve KO:',
          (e as Error)?.message,
        )
      }
    }

    // ─── 3. Construit la liste d'emails candidats à interroger sur Stripe ────
    const emails: string[] = []
    const paymentEmail = (dbProfile?.stripe_payment_email || '').trim().toLowerCase()
    if (paymentEmail) emails.push(paymentEmail)
    if (userEmail && !emails.includes(userEmail)) emails.push(userEmail)

    // ─── 3b. Lookup côté SERVEUR : table stripe_pending_links ────────────────
    // Le webhook a stocké la liaison ici dès la fin du checkout, même si le
    // user Supabase n'existait pas encore. C'est le pont qui survit à TOUT :
    // cross-device, données navigateur effacées, navigation privée, ITP,
    // delays entre paiement et signup.
    if (adminClient) {
      const pending = await findPendingLinkForUser(adminClient, emails)
      if (pending && pending.customer_id) {
        try {
          const updates: Record<string, unknown> = {
            plan: pending.plan,
            subscription_status: pending.subscription_status,
            credits_remaining:
              dbProfile?.plan === pending.plan &&
              typeof dbProfile?.credits_remaining === 'number' &&
              dbProfile.credits_remaining > pending.credits
                ? dbProfile.credits_remaining
                : pending.credits,
            stripe_customer_id: pending.customer_id,
          }
          if (pending.stripe_email) updates.stripe_payment_email = pending.stripe_email
          await adminClient.from('users').update(updates).eq('id', userId)
        } catch (e) {
          console.warn(
            '[stripe-resolve-access] pending_link sync DB KO:',
            (e as Error)?.message,
          )
        }
        await markPendingLinkConsumed(adminClient, pending.session_id, userId)
        return res.status(200).json({
          ok: true,
          plan: pending.plan,
          credits: pending.credits,
          subscription_status: pending.subscription_status,
          customerId: pending.customer_id,
          paymentEmail: pending.stripe_email,
          reason: 'pending_link_match',
        })
      }
    }

    // ─── 4. Localise le Customer Stripe ──────────────────────────────────────
    let customerId: string | null = (dbProfile?.stripe_customer_id || '').trim() || null

    if (!customerId) {
      customerId = await findCustomerIdByEmails(stripe, emails)
    }

    if (!customerId) {
      return res.status(200).json({
        ok: false,
        reason: 'no_stripe_customer',
        triedEmails: emails,
      })
    }

    // ─── 5. Cherche une subscription en active / trialing / past_due ─────────
    const sub = await findActiveSubscription(stripe, customerId)
    if (!sub) {
      // Customer existe mais pas d'abo actif → vraie absence de droit d'accès.
      return res.status(200).json({
        ok: false,
        reason: 'no_active_subscription',
        customerId,
      })
    }

    const plan = planFromSubscription(sub)
    const subscription_status: SubStatus =
      sub.status === 'trialing'
        ? 'trialing'
        : sub.status === 'past_due'
          ? 'active' // on accorde l'accès tant que Stripe re-tente le paiement
          : 'active'

    const credits =
      dbProfile?.plan === plan && typeof dbProfile?.credits_remaining === 'number'
        ? dbProfile.credits_remaining // on NE diminue PAS un solde existant
        : plan === 'monthly' && subscription_status === 'trialing'
          ? MONTHLY_TRIAL_CREDITS
          : PLAN_CREDITS[plan]

    // Email réel utilisé pour payer (peut différer de l'email du compte).
    let resolvedPaymentEmail = paymentEmail
    if (!resolvedPaymentEmail) {
      try {
        const customer = await stripe.customers.retrieve(customerId)
        if (customer && !(customer as Stripe.DeletedCustomer).deleted) {
          const e = ((customer as Stripe.Customer).email || '').trim().toLowerCase()
          if (e) resolvedPaymentEmail = e
        }
      } catch { /* ignore */ }
    }

    // ─── 6. Synchronise la DB Supabase (idempotent, sécurité service_role) ───
    if (adminClient) {
      try {
        const updates: Record<string, unknown> = {
          plan,
          subscription_status,
          credits_remaining: credits,
          stripe_customer_id: customerId,
        }
        if (resolvedPaymentEmail) updates.stripe_payment_email = resolvedPaymentEmail
        await adminClient.from('users').update(updates).eq('id', userId)
      } catch (dbErr) {
        console.warn('[stripe-resolve-access] sync DB KO (non bloquant):', (dbErr as Error)?.message)
      }
    }

    return res.status(200).json({
      ok: true,
      plan,
      credits,
      subscription_status,
      customerId,
      paymentEmail: resolvedPaymentEmail || null,
      reason: 'stripe_active',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-resolve-access] error', msg)
    return res.status(500).json({ error: msg || 'Vérification accès impossible' })
  }
}
