import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_middleware'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  // Données mock — à connecter à Stripe webhooks + Supabase payments table
  const months = ['Nov', 'Déc', 'Jan', 'Fév', 'Mar', 'Avr']
  const monthlyData = months.map((month, i) => ({
    month,
    revenue: Math.floor(200 + i * 120 + Math.random() * 80),
    cost: Math.floor(15 + i * 8 + Math.random() * 10),
    margin: 0,
  })).map(m => ({ ...m, margin: m.revenue - m.cost }))

  return res.status(200).json({
    currentMonth: {
      revenue: 620.3,
      cost: 47.8,
      margin: 572.5,
      marginPct: 92.3,
      mythos: 1292,
      newSubscribers: 27,
      cancellations: 5,
      churnRate: 4.2,
    },
    monthlyData,
    planSplit: { weekly: 28, monthly: 72 },
    topClients: [
      { rank: 1, email: 'power@user.fr', plan: 'monthly', revenue: 79.2, net: 72.1 },
      { rank: 2, email: 'fan@gomytho.com', plan: 'monthly', revenue: 59.4, net: 55.2 },
      { rank: 3, email: 'prank@master.io', plan: 'weekly', revenue: 47.84, net: 44.6 },
    ],
  })
}
