import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_middleware'
import { createClient } from '@supabase/supabase-js'

const WEEKLY_PRICE = 2.99
const MONTHLY_PRICE = 9.90
const COST_PER_IMAGE = 0.037

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const supabase = getSupabase()
  if (!supabase) return res.status(200).json(buildEmpty())

  try {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() // 0-based

    // Récupérer tous les utilisateurs et mythos
    const [{ data: allUsers }, { data: allMythos }] = await Promise.all([
      supabase.from('users').select('id, plan, subscription_status, created_at'),
      supabase.from('mythos').select('id, user_id, created_at'),
    ])

    const users = allUsers || []
    const mythos = allMythos || []

    // Répartition par plan (abonnés actifs)
    const activeUsers = users.filter(u => u.subscription_status === 'active')
    const weeklyCount = activeUsers.filter(u => u.plan === 'weekly').length
    const monthlyCount = activeUsers.filter(u => u.plan === 'monthly').length

    // Mois courant
    const startOfMonth = new Date(currentYear, currentMonth, 1)
    const newThisMonth = users.filter(u =>
      u.subscription_status === 'active' && new Date(u.created_at) >= startOfMonth
    )
    const mythosThisMonth = mythos.filter(m => new Date(m.created_at) >= startOfMonth)
    const cancelledThisMonth = users.filter(u =>
      u.subscription_status === 'cancelled' && new Date(u.created_at) >= startOfMonth
    )

    const revenueThisMonth = newThisMonth.reduce((acc, u) =>
      acc + (u.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE), 0)
    const costThisMonth = mythosThisMonth.length * COST_PER_IMAGE
    const marginThisMonth = revenueThisMonth - costThisMonth
    const marginPct = revenueThisMonth > 0 ? (marginThisMonth / revenueThisMonth) * 100 : 0
    const totalActiveMonth = users.filter(u => u.subscription_status !== 'inactive').length
    const churnRate = totalActiveMonth > 0 ? (cancelledThisMonth.length / totalActiveMonth) * 100 : 0

    // Graphe 6 derniers mois
    const monthlyData = []
    for (let i = 5; i >= 0; i--) {
      const m = new Date(currentYear, currentMonth - i, 1)
      const mEnd = new Date(currentYear, currentMonth - i + 1, 1)
      const label = MONTH_LABELS[m.getMonth()]

      const newInMonth = users.filter(u =>
        u.subscription_status === 'active' &&
        new Date(u.created_at) >= m &&
        new Date(u.created_at) < mEnd
      )
      const mythosInMonth = mythos.filter(mt =>
        new Date(mt.created_at) >= m && new Date(mt.created_at) < mEnd
      )

      const rev = newInMonth.reduce((acc, u) =>
        acc + (u.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE), 0)
      const cost = mythosInMonth.length * COST_PER_IMAGE

      monthlyData.push({
        month: label,
        revenue: +rev.toFixed(2),
        cost: +cost.toFixed(2),
        margin: +(rev - cost).toFixed(2),
      })
    }

    // Top clients (ceux qui ont le plus de mythos)
    const mythosByUser: Record<string, number> = {}
    mythos.forEach(m => { mythosByUser[m.user_id] = (mythosByUser[m.user_id] || 0) + 1 })
    const topClients = Object.entries(mythosByUser)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([userId, count]) => {
        const user = users.find(u => u.id === userId)
        const rev = user?.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE
        return {
          email: user?.email || userId.slice(0, 8) + '...',
          plan: user?.plan || 'unknown',
          mythos: count,
          revenue: +rev.toFixed(2),
          cost: +(count * COST_PER_IMAGE).toFixed(2),
        }
      })

    return res.status(200).json({
      currentMonth: {
        revenue: +revenueThisMonth.toFixed(2),
        cost: +costThisMonth.toFixed(2),
        margin: +marginThisMonth.toFixed(2),
        marginPct: +marginPct.toFixed(1),
        mythos: mythosThisMonth.length,
        newSubscribers: newThisMonth.length,
        cancellations: cancelledThisMonth.length,
        churnRate: +churnRate.toFixed(1),
      },
      monthlyData,
      planSplit: { weekly: weeklyCount, monthly: monthlyCount },
      topClients,
    })
  } catch (e) {
    console.error('Admin finance error:', e)
    return res.status(200).json(buildEmpty())
  }
}

function buildEmpty() {
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { month: MONTH_LABELS[m.getMonth()], revenue: 0, cost: 0, margin: 0 }
  })
  return {
    currentMonth: { revenue: 0, cost: 0, margin: 0, marginPct: 0, mythos: 0, newSubscribers: 0, cancellations: 0, churnRate: 0 },
    monthlyData: months,
    planSplit: { weekly: 0, monthly: 0 },
    topClients: [],
  }
}
