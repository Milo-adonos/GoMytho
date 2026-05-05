import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// ─── Annulation directe d'abonnement Stripe ─────────────────────────────────
//
// Pourquoi ne pas passer par le portail Stripe ?
//   - Le portail nécessite une configuration explicite dans le dashboard
//     (sinon l'API billingPortal.sessions.create renvoie une erreur)
//   - Le portail "magic link" demande à l'utilisateur de re-saisir son email
//     puis de cliquer dans un mail — UX lourde
//
// Cette route :
//   1. Auth : vérifie le token Supabase de l'utilisateur connecté
//   2. Trouve son customer Stripe (via email)
//   3. Annule la / les subscriptions actives en fin de période courante
//      (cancel_at_period_end = true → l'utilisateur garde son accès jusqu'au
//       terme de la période déjà payée, c'est légalement attendu)
//   4. Met à jour public.users.subscription_status = 'cancelled' (best-effort)

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

  if (!supabaseUrl || !anonKey || !stripeSecret) {
    return res.status(500).json({ error: 'Configuration serveur manquante' })
  }

  const token = getUserFromBearer(req)
  if (!token) return res.status(401).json({ error: 'Non authentifié' })

  try {
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: authData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Session invalide' })
    }
    const userEmail = authData.user.email
    if (!userEmail) return res.status(400).json({ error: 'Email manquant' })

    const stripe = new Stripe(stripeSecret)
    const adminClient = serviceKey ? createClient(supabaseUrl, serviceKey) : null

    // ─── Trouver le customer Stripe ─────────────────────────────────────────
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
      return res.status(404).json({ error: 'Aucun client Stripe trouvé pour cet email' })
    }

    // ─── Lister les subscriptions actives ou en essai ─────────────────────────
    const allOpenSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    })
    const subs = {
      data: allOpenSubs.data.filter((s) => s.status === 'active' || s.status === 'trialing'),
    }

    if (subs.data.length === 0) {
      // Peut-être déjà en cancel_at_period_end ou dans un autre status
      const alreadyCancelling = allOpenSubs.data.find(
        (s) => s.cancel_at_period_end || s.status === 'canceled',
      )
      if (alreadyCancelling) {
        return res.status(200).json({
          ok: true,
          alreadyCancelled: true,
          message: 'Abonnement déjà annulé',
          endsAt: alreadyCancelling.cancel_at
            ? new Date(alreadyCancelling.cancel_at * 1000).toISOString()
            : null,
        })
      }
      return res.status(404).json({ error: 'Aucun abonnement actif à annuler' })
    }

    // ─── Annulation en fin de période (l'utilisateur garde son accès jusque là)
    const cancelled = []
    for (const sub of subs.data) {
      const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      })
      // Cast `any` : `current_period_end` est déplacé selon la version de
      // l'API Stripe ; on lit défensivement à la racine puis sur l'item.
      const updatedAny = updated as unknown as {
        current_period_end?: number
        items?: { data?: Array<{ current_period_end?: number }> }
      }
      const endTs =
        updatedAny.current_period_end ??
        updatedAny.items?.data?.[0]?.current_period_end ??
        null
      cancelled.push({
        id: updated.id,
        endsAt: endTs ? new Date(endTs * 1000).toISOString() : null,
      })
    }

    // ─── Mettre à jour le profil DB (non bloquant) ──────────────────────────
    if (adminClient) {
      try {
        await adminClient
          .from('users')
          .update({ subscription_status: 'cancelled' })
          .eq('id', authData.user.id)
      } catch (e: any) {
        console.warn('[stripe-cancel] update DB échoué (non bloquant):', e?.message || e)
      }
    }

    const firstEnd = cancelled[0]?.endsAt
    return res.status(200).json({
      ok: true,
      cancelled: cancelled.length,
      endsAt: firstEnd,
      message: firstEnd
        ? `Abonnement annulé. Tu gardes ton accès jusqu'au ${new Date(firstEnd).toLocaleDateString('fr-FR')}.`
        : 'Abonnement annulé',
    })
  } catch (e: any) {
    console.error('[stripe-cancel] error:', e?.message || e)
    return res.status(500).json({
      error: e?.message || 'Annulation impossible',
    })
  }
}
