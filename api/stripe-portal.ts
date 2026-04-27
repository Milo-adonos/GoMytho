import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

function getOrigin(req: VercelRequest) {
  const origin = req.headers.origin as string | undefined
  if (origin) return origin
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  return host ? `${proto}://${host}` : 'https://gomytho.com'
}

function getUserFromBearer(req: VercelRequest) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  return token
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
    return res.status(500).json({ error: 'Missing server configuration' })
  }

  const token = getUserFromBearer(req)
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: authData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Invalid session' })
    }

    const userEmail = authData.user.email
    if (!userEmail) return res.status(400).json({ error: 'Missing user email' })

    const stripe = new Stripe(stripeSecret)
    const adminClient = serviceKey ? createClient(supabaseUrl, serviceKey) : null

    const normalizedAccountEmail = userEmail.trim().toLowerCase()

    // Liste de candidats d'email à interroger sur Stripe, par ordre de priorité.
    // 1) stripe_payment_email (email réellement utilisé pour payer — Apple Pay,
    //    Google Pay, alias…) — STRICTEMENT PRIORITAIRE.
    // 2) email du compte GoMytho (cas standard où c'est le même).
    const emailCandidates: string[] = []
    let dbStripeCustomerId: string | null = null

    if (adminClient) {
      const { data: profile } = await adminClient
        .from('users')
        .select('stripe_customer_id, stripe_payment_email')
        .eq('id', authData.user.id)
        .maybeSingle()
      dbStripeCustomerId = profile?.stripe_customer_id || null
      const paymentEmail = (profile?.stripe_payment_email as string | undefined)?.trim().toLowerCase()
      if (paymentEmail) emailCandidates.push(paymentEmail)
    }
    if (!emailCandidates.includes(normalizedAccountEmail)) {
      emailCandidates.push(normalizedAccountEmail)
    }

    let customerId: string | null = dbStripeCustomerId

    // ── Fallback 1 : Stripe customers.list par email (priorité au paymentEmail) ──
    if (!customerId) {
      for (const candidate of emailCandidates) {
        try {
          const customers = await stripe.customers.list({ email: candidate, limit: 10 })
          if (customers.data[0]?.id) {
            customerId = customers.data[0].id
            break
          }
        } catch (e) {
          console.warn('[stripe-portal] customers.list failed:', (e as any)?.message)
        }
      }
    }

    // ── Fallback 2 : Stripe Search API (gère majuscules / alias) ─────────────
    if (!customerId) {
      for (const candidate of emailCandidates) {
        try {
          const search = await stripe.customers.search({
            query: `email:'${candidate}'`,
            limit: 10,
          })
          if (search.data[0]?.id) {
            customerId = search.data[0].id
            break
          }
        } catch (e) {
          console.warn('[stripe-portal] customers.search failed:', (e as any)?.message)
        }
      }
    }

    // ── Fallback 3 : balayer les subscriptions et matcher l'email ──────────
    if (!customerId) {
      try {
        const subs = await stripe.subscriptions.list({
          status: 'all',
          limit: 100,
          expand: ['data.customer'],
        })
        const matching = subs.data.find((s) => {
          const cust = s.customer as Stripe.Customer | string
          if (!cust || typeof cust === 'string') return false
          const email = (cust.email || '').trim().toLowerCase()
          return emailCandidates.includes(email)
        })
        if (matching) {
          const cust = matching.customer as Stripe.Customer
          customerId = cust.id
        }
      } catch (e) {
        console.warn('[stripe-portal] subscriptions.list scan failed:', (e as any)?.message)
      }
    }

    if (!customerId) {
      // Pas trouvé → le frontend gère le fallback magic-link.
      return res.status(404).json({
        error: 'Aucun customer Stripe trouvé pour ce compte.',
        triedEmails: emailCandidates,
      })
    }

    // Persiste pour les prochains appels (un seul aller-retour à l'avenir).
    // Récupère aussi l'email du customer Stripe si on n'avait pas de
    // stripe_payment_email en DB (cas des comptes anciens).
    if (adminClient) {
      try {
        const updates: Record<string, unknown> = { stripe_customer_id: customerId }
        try {
          const cust = await stripe.customers.retrieve(customerId)
          if (cust && !(cust as Stripe.DeletedCustomer).deleted) {
            const stripeEmail = ((cust as Stripe.Customer).email || '').trim().toLowerCase()
            if (stripeEmail) updates.stripe_payment_email = stripeEmail
          }
        } catch { /* ignore */ }
        await adminClient
          .from('users')
          .update(updates)
          .eq('id', authData.user.id)
      } catch (e) {
        console.warn('[stripe-portal] persist customerId failed:', (e as any)?.message)
      }
    }

    const returnUrl =
      (req.body?.returnUrl as string | undefined) ||
      `${getOrigin(req)}/settings`

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      })
      return res.status(200).json({ url: session.url })
    } catch (portalErr: any) {
      // Erreur typique : le Customer Portal n'est pas configuré dans le
      // dashboard Stripe → URL : https://dashboard.stripe.com/settings/billing/portal
      const message = portalErr?.message || 'Customer Portal Stripe non configuré'
      console.error('[stripe-portal] portal create failed:', message)
      return res.status(500).json({
        error: message.includes('configuration')
          ? 'Le portail Stripe n\'est pas encore activé. Réessaie dans quelques minutes.'
          : message,
      })
    }
  } catch (error: any) {
    console.error('stripe-portal error:', error?.message || error)
    return res.status(500).json({ error: error?.message || 'Unable to create portal session' })
  }
}
