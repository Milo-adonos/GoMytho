import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_middleware'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const months = ['Nov', 'Déc', 'Jan', 'Fév', 'Mar', 'Avr']

  return res.status(200).json({
    currentMonth: {
      revenue: 0, cost: 0, margin: 0, marginPct: 0,
      mythos: 0, newSubscribers: 0, cancellations: 0, churnRate: 0,
    },
    monthlyData: months.map(month => ({ month, revenue: 0, cost: 0, margin: 0 })),
    planSplit: { weekly: 0, monthly: 0 },
    topClients: [],
  })
}
