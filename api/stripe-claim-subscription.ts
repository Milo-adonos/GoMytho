import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// ─── Endpoint « Récupérer mon abonnement » (claim by email) ──────────────────
//
// Self-service pour un utilisateur authentifié qui ne se voit pas reconnaître
// comme payant. Cas typique : il a payé sur Stripe avec un email A
// (Apple Pay / Google Pay / Revolut Pay / alias), puis s'est inscrit sur
// Supabase avec un email B. Aucune liaison automatique ne marche faute
// de match d'email — il a besoin d'indiquer EXPLICITEMENT son email Stripe.
//
// Sécurité (option « rapide » côté MVP — pas de vérification par code email) :
//   - L'utilisateur DOIT être authentifié (Bearer token Supabase valide).
//   - Le Customer Stripe à lier ne doit PAS être déjà rattaché à un autre
//     user Supabase (ni dans la table `users`, ni dans la metadata Stripe).
//   - Si déjà lié à un autre compte → on refuse avec un message clair.
//   - Une fois la liaison faite, on écrit `metadata.supabase_user_id` sur
//     le Customer Stripe pour que toute tentative ultérieure de re-claim
//     par un autre compte échoue.
//
// Améliorations possibles plus tard (à activer si besoin) :
//   - Envoi d'un code à 6 chiffres à l'email Stripe (vérif possession).
//   - Historique des tentatives de claim (rate limit, log Sentry/PostHog).

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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

async function findCustomersByEmail(
  stripe: Stripe,
  email: string,
): Promise<Stripe.Customer[]> {
  const out: Stripe.Customer[] = []
  try {
    const list = await stripe.customers.list({ email, limit: 25 })
    for (const c of list.data) {
      if (!('deleted' in c) || !c.deleted) out.push(c)
    }
  } catch (e) {
    console.warn('[stripe-claim] customers.list KO:', (e as Error)?.message)
  }
  if (out.length === 0) {
    try {
      const search = await stripe.customers.search({
        query: `email:'${email.replace(/'/g, "\\'")}'`,
        limit: 25,
      })
      for (const c of search.data) {
        if (!('deleted' in c) || !c.deleted) out.push(c)
      }
    } catch (e) {
      console.warn('[stripe-claim] customers.search KO:', (e as Error)?.message)
    }
  }
  return out
}

async function findActiveSub(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    })
    return subs.data.find((s) => isPaidStatus(s.status)) || null
  } catch (e) {
    console.warn('[stripe-claim] subs by customer KO:', (e as Error)?.message)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const stripeSecret = process.env.STRIPE_SECRET_KEY

  if (!supabaseUrl || !anonKey || !stripeSecret) {
    console.error('[stripe-claim] env manquantes')
    return res.status(500).json({ error: 'Configuration serveur incomplète' })
  }
  if (!serviceKey) {
    console.error('[stripe-claim] SUPABASE_SERVICE_ROLE_KEY manquant')
    return res.status(500).json({
      error: 'Configuration serveur incomplète (service_role).',
    })
  }

  const token = getBearer(req)
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  // Lecture du body
  let claimEmail = ''
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    claimEmail = String(
      (body as { email?: string }).email ||
        (body as { paymentEmail?: string }).paymentEmail ||
        '',
    )
      .trim()
      .toLowerCase()
  } catch {
    return res.status(400).json({ error: 'Body invalide' })
  }
  if (!claimEmail || !EMAIL_REGEX.test(claimEmail)) {
    return res.status(400).json({ error: 'Email invalide.' })
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: authData, error: authErr } = await authClient.auth.getUser(token)
    if (authErr || !authData.user) {
      return res.status(401).json({ error: 'Session invalide.' })
    }
    const userId = authData.user.id
    const userEmail = (authData.user.email || '').trim().toLowerCase()

    const adminClient = createClient(supabaseUrl, serviceKey)
    const stripe = new Stripe(stripeSecret)

    // ─── 1. Recherche les Customers Stripe avec cet email ────────────────────
    const candidates = await findCustomersByEmail(stripe, claimEmail)
    if (candidates.length === 0) {
      return res.status(404).json({
        ok: false,
        reason: 'no_customer',
        error: "Aucun compte Stripe trouvé avec cet email.",
      })
    }

    // ─── 2. Pour chacun : vérifie l'abo actif + l'absence de liaison existante
    let chosen: {
      customer: Stripe.Customer
      sub: Stripe.Subscription
    } | null = null

    for (const customer of candidates) {
      const sub = await findActiveSub(stripe, customer.id)
      if (!sub) continue

      // 2a. Le Customer est-il déjà rattaché à un AUTRE user Supabase via la
      // table `users.stripe_customer_id` ?
      try {
        const { data: existingLink } = await adminClient
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customer.id)
          .neq('id', userId)
          .maybeSingle()
        if (existingLink?.id) {
          return res.status(409).json({
            ok: false,
            reason: 'already_linked',
            error:
              "Cet abonnement est déjà rattaché à un autre compte. Connecte-toi avec l'email de ce compte, ou contacte le support.",
          })
        }
      } catch (e) {
        console.warn('[stripe-claim] check existing DB link KO:', (e as Error)?.message)
      }

      // 2b. Le Customer a-t-il déjà une metadata supabase_user_id pointant
      // sur un AUTRE user ?
      const metaUser = (customer.metadata?.supabase_user_id || '').trim()
      if (metaUser && metaUser !== userId) {
        return res.status(409).json({
          ok: false,
          reason: 'already_linked_metadata',
          error:
            "Cet abonnement est déjà rattaché à un autre compte (vérification Stripe). Contacte le support si tu penses que c'est une erreur.",
        })
      }

      chosen = { customer, sub }
      break
    }

    if (!chosen) {
      return res.status(404).json({
        ok: false,
        reason: 'no_active_sub',
        error: "Aucun abonnement actif pour cet email.",
      })
    }

    // ─── 3. Liaison : DB Supabase + metadata Stripe ──────────────────────────
    const plan = planFromSubscription(chosen.sub)
    const subscription_status: SubStatus =
      chosen.sub.status === 'trialing'
        ? 'trialing'
        : chosen.sub.status === 'past_due'
          ? 'active'
          : 'active'

    // Crédits : on ne diminue jamais le solde existant si plan identique.
    let credits = plan === 'monthly' && subscription_status === 'trialing'
      ? MONTHLY_TRIAL_CREDITS
      : PLAN_CREDITS[plan]
    try {
      const { data: existing } = await adminClient
        .from('users')
        .select('plan, credits_remaining')
        .eq('id', userId)
        .maybeSingle()
      if (
        existing?.plan === plan &&
        typeof existing.credits_remaining === 'number' &&
        existing.credits_remaining > credits
      ) {
        credits = existing.credits_remaining
      }
    } catch { /* ignore */ }

    const customerEmail = (chosen.customer.email || '').trim().toLowerCase() || null
    try {
      const updates: Record<string, unknown> = {
        plan,
        subscription_status,
        credits_remaining: credits,
        stripe_customer_id: chosen.customer.id,
      }
      if (customerEmail) updates.stripe_payment_email = customerEmail
      else updates.stripe_payment_email = claimEmail
      await adminClient.from('users').update(updates).eq('id', userId)
    } catch (e) {
      console.warn('[stripe-claim] DB update KO:', (e as Error)?.message)
      return res.status(500).json({
        ok: false,
        reason: 'db_update_failed',
        error: 'Liaison impossible (DB). Réessaie dans quelques instants.',
      })
    }

    // 3b. Marque les pending_links non consommés correspondants comme
    // « consommés » par cet utilisateur, pour ne pas re-jouer.
    try {
      await adminClient
        .from('stripe_pending_links')
        .update({ consumed_at: new Date().toISOString(), consumed_by_user_id: userId })
        .eq('customer_id', chosen.customer.id)
        .is('consumed_at', null)
    } catch { /* ignore */ }

    // 3c. Marque le Customer Stripe avec metadata.supabase_user_id pour
    // verrouiller la liaison côté Stripe (toute tentative de re-claim
    // par un autre compte sera refusée à l'étape 2b).
    try {
      await stripe.customers.update(chosen.customer.id, {
        metadata: {
          ...(chosen.customer.metadata || {}),
          supabase_user_id: userId,
          supabase_email: userEmail,
        },
      })
    } catch (e) {
      // Non bloquant — la liaison côté DB est déjà faite.
      console.warn('[stripe-claim] Stripe metadata update KO:', (e as Error)?.message)
    }

    return res.status(200).json({
      ok: true,
      plan,
      credits,
      subscription_status,
      customerId: chosen.customer.id,
      paymentEmail: customerEmail || claimEmail,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-claim] error', msg)
    return res.status(500).json({ error: msg || 'Échec de la liaison.' })
  }
}
