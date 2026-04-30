import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ─── Vérifie qu'un email a un abonnement Stripe actif ─────────────────────────
//
// Pourquoi ?
//   Quand un utilisateur revient via /login mais que son profil Supabase est
//   resté en plan='free' / 0 crédits (webhook pas encore tourné, env vars
//   absentes au signup, etc.), on ne peut pas le rejeter à tort. On demande
//   donc à Stripe directement : « est-ce que cet email a un abonnement
//   actif ? ». Si oui, on renvoie le plan + crédits associés et on
//   re-synchronise le profil Supabase pour les fois suivantes.
//
// Sécurité : on EXIGE un Supabase access token et on vérifie que l'email
// demandé correspond bien au user connecté (anti-énumération).

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!stripeSecret) {
    console.error('[stripe-check-email] STRIPE_SECRET_KEY manquant')
    return res.status(500).json({ error: 'Configuration serveur incomplète' })
  }
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ error: 'Configuration Supabase incomplète' })
  }

  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authErr } = await authClient.auth.getUser(token)
  if (authErr || !authData.user) {
    return res.status(401).json({ error: 'Invalid session' })
  }
  const userEmail = (authData.user.email || '').toLowerCase()
  const userId = authData.user.id

  // Email à vérifier : par défaut, celui du compte connecté. Le client peut
  // passer un email alternatif (ex: stripe_payment_email Apple Pay relay).
  const requested = String((req.body as any)?.email || '').toLowerCase().trim()
  const target = requested || userEmail
  if (!target) return res.status(400).json({ error: 'Email manquant' })

  // Anti-énumération : on n'accepte que des emails liés à l'utilisateur connecté.
  // (Soit son email auth, soit un alias trouvé sur son profil Supabase.)
  let allowed = target === userEmail
  if (!allowed && serviceKey) {
    try {
      const adminClient = createClient(supabaseUrl, serviceKey)
      const { data: row } = await adminClient
        .from('users')
        .select('email, stripe_payment_email')
        .eq('id', userId)
        .maybeSingle()
      const aliases = [row?.email, row?.stripe_payment_email]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
      allowed = aliases.includes(target)
    } catch { /* deny by default */ }
  }
  if (!allowed) {
    return res.status(403).json({ error: 'Email non autorisé pour ce compte' })
  }

  try {
    const stripe = new Stripe(stripeSecret)

    // 1) Cherche les customers Stripe avec cet email
    const customers = await stripe.customers.list({ email: target, limit: 5 })
    if (!customers.data.length) {
      return res.status(200).json({ found: false })
    }

    // 2) Pour chaque customer, on liste les subscriptions actives
    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 5,
      })
      const activeSub = subs.data.find((s) =>
        s.status === 'active' || s.status === 'trialing' || s.status === 'past_due',
      )
      if (!activeSub) continue

      // 3) On infère le plan depuis le price.id ou le montant unitaire
      const item = activeSub.items?.data?.[0]
      const priceId = item?.price?.id || ''
      const unitAmount = item?.price?.unit_amount ?? 0

      const HEBDO_PRICE_ID = (process.env.HEBDO_PRICE_ID || '').trim()
      const MENSU_PRICE_ID = (process.env.MENSU_PRICE_ID || '').trim()

      let plan: 'weekly' | 'monthly' = 'monthly'
      if (HEBDO_PRICE_ID && priceId === HEBDO_PRICE_ID) plan = 'weekly'
      else if (MENSU_PRICE_ID && priceId === MENSU_PRICE_ID) plan = 'monthly'
      else if (Math.abs(unitAmount - 299) <= 5) plan = 'weekly'
      else if (Math.abs(unitAmount - 990) <= 5) plan = 'monthly'
      else if (unitAmount > 0 && unitAmount < 500) plan = 'weekly'

      const credits = plan === 'weekly' ? 160 : 560
      const subscription_status =
        activeSub.status === 'trialing' ? 'trialing' : 'active'

      // 4) Re-sync le profil Supabase pour que les futures requêtes par id
      // trouvent le bon plan (et que hasPaidGoMythoAccess passe).
      if (serviceKey) {
        try {
          const adminClient = createClient(supabaseUrl, serviceKey)
          await adminClient.from('users').upsert(
            [{
              id: userId,
              email: userEmail || target,
              plan,
              credits_remaining: credits,
              subscription_status,
              stripe_customer_id: customer.id,
              stripe_payment_email: target,
            }],
            { onConflict: 'id' },
          )
        } catch (err) {
          console.warn('[stripe-check-email] sync supabase échoué (non bloquant):', err)
        }
      }

      return res.status(200).json({
        found: true,
        plan,
        credits,
        subscription_status,
        customerId: customer.id,
        email: target,
      })
    }

    return res.status(200).json({ found: false })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-check-email] erreur:', msg)
    return res.status(500).json({ error: msg || 'Vérification Stripe impossible' })
  }
}
