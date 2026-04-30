import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

/**
 * À appeler côté app quand public.users.subscription_status = 'trialing' (mensuel).
 * Si Stripe indique que l’abonnement est passé en `active`, on bascule le statut
 * et on accorde le quota mensuel complet (fin d’essai, premier paiement encaissé).
 */

const MENSU_PRICE_ID = process.env.MENSU_PRICE_ID || 'price_1TQbP8CiUqAkK3BJ1mBxAgqA'
const MONTHLY_FULL_CREDITS = 560

function getUserFromBearer(req: VercelRequest) {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const stripeSecret = process.env.STRIPE_SECRET_KEY

  if (!supabaseUrl || !anonKey || !stripeSecret || !serviceKey) {
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

    const userId = authData.user.id
    const adminClient = createClient(supabaseUrl, serviceKey)
    const stripe = new Stripe(stripeSecret)

    const { data: profile } = await adminClient
      .from('users')
      .select('subscription_status, plan, stripe_customer_id, stripe_payment_email, email')
      .eq('id', userId)
      .maybeSingle()

    if (!profile || profile.plan !== 'monthly' || profile.subscription_status !== 'trialing') {
      return res.status(200).json({ updated: false })
    }

    let customerId = profile.stripe_customer_id as string | null
    const userEmail = (authData.user.email || profile.email as string | undefined)?.trim().toLowerCase()
    const paymentEmail = (profile.stripe_payment_email as string | undefined)?.trim().toLowerCase()

    if (!customerId) {
      for (const candidate of [paymentEmail, userEmail].filter(Boolean) as string[]) {
        try {
          const customers = await stripe.customers.list({ email: candidate, limit: 5 })
          if (customers.data[0]?.id) {
            customerId = customers.data[0].id
            break
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (!customerId) {
      return res.status(200).json({ updated: false, reason: 'no_stripe_customer' })
    }

    const subs = await stripe.subscriptions.list({ customer: customerId, limit: 25 })
    const monthlySub = subs.data.find((s) =>
      s.items.data.some((item) => item.price?.id === MENSU_PRICE_ID),
    )

    if (!monthlySub || monthlySub.status !== 'active') {
      return res.status(200).json({ updated: false })
    }

    await adminClient
      .from('users')
      .update({
        subscription_status: 'active',
        credits_remaining: MONTHLY_FULL_CREDITS,
      })
      .eq('id', userId)

    return res.status(200).json({ updated: true, credits: MONTHLY_FULL_CREDITS })
  } catch (err: any) {
    console.error('[stripe-sync-trial]', err?.message || err)
    return res.status(500).json({ error: err?.message || 'sync failed' })
  }
}
