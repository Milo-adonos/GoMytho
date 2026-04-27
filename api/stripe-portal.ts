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

    let customerId: string | null = null

    if (adminClient) {
      const { data: profile } = await adminClient
        .from('users')
        .select('stripe_customer_id')
        .eq('id', authData.user.id)
        .maybeSingle()
      customerId = profile?.stripe_customer_id || null
    }

    if (!customerId) {
      const customers = await stripe.customers.list({ email: userEmail, limit: 1 })
      customerId = customers.data[0]?.id || null
    }

    if (!customerId) {
      return res.status(404).json({ error: 'No Stripe customer found' })
    }

    if (adminClient) {
      await adminClient
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', authData.user.id)
    }

    const returnUrl =
      (req.body?.returnUrl as string | undefined) ||
      `${getOrigin(req)}/settings`

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })

    return res.status(200).json({ url: session.url })
  } catch (error) {
    console.error('stripe-portal error:', error)
    return res.status(500).json({ error: 'Unable to create portal session' })
  }
}
