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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const supabase = getSupabase()
  if (!supabase) return res.status(200).json(buildEmpty())

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30)
    const sixtyDaysAgo = new Date(now); sixtyDaysAgo.setDate(now.getDate() - 60)

    const [
      { data: allUsers },
      { data: newUsers30d },
      { data: newUsersPrev30d },
      { data: mythos30d },
      { data: allMythos },
      { count: cancelledCount },
    ] = await Promise.all([
      supabase.from('users').select('id, plan, subscription_status, created_at'),
      supabase.from('users').select('id, plan, created_at').gte('created_at', thirtyDaysAgo.toISOString()).eq('subscription_status', 'active'),
      supabase.from('users').select('id').gte('created_at', sixtyDaysAgo.toISOString()).lt('created_at', thirtyDaysAgo.toISOString()).eq('subscription_status', 'active'),
      supabase.from('mythos').select('id, created_at').gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('mythos').select('id, created_at'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('subscription_status', 'cancelled'),
    ])

    const users = allUsers || []
    const activeUsers = users.filter(u => u.subscription_status === 'active')
    const weeklyUsers = activeUsers.filter(u => u.plan === 'weekly')
    const monthlyUsers = activeUsers.filter(u => u.plan === 'monthly')

    // Revenus estimés : abonnés actifs × leur prix mensuel
    const weeklyRevenue = weeklyUsers.length * WEEKLY_PRICE * 4.33 // ~4.33 semaines/mois
    const monthlyRevenue = monthlyUsers.length * MONTHLY_PRICE
    const totalRevenue = weeklyRevenue + monthlyRevenue

    // Revenus 30 derniers jours : nouveaux abonnés × leur plan
    const revenue30d = (newUsers30d || []).reduce((acc, u) => {
      return acc + (u.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE)
    }, 0)

    const prevRevenue30d = (newUsersPrev30d || []).length * MONTHLY_PRICE // estimation
    const revenueGrowth = prevRevenue30d > 0 ? ((revenue30d - prevRevenue30d) / prevRevenue30d) * 100 : 0

    const totalMythos = (allMythos || []).length
    const totalCost = totalMythos * COST_PER_IMAGE
    const netProfit = totalRevenue - totalCost
    const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

    const totalActiveUsers = users.filter(u => u.subscription_status !== 'inactive').length
    const churnRate = totalActiveUsers > 0 ? ((cancelledCount || 0) / totalActiveUsers) * 100 : 0

    // Graphe journalier 30 derniers jours
    const dailyMap: Record<string, { revenue: number; mythos: number }> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i)
      dailyMap[d.toISOString().split('T')[0]] = { revenue: 0, mythos: 0 }
    }

    // Revenus par jour (nouveaux abonnés)
    const newUsersList = newUsers30d || []
    newUsersList.forEach(u => {
      const day = u.created_at.split('T')[0]
      if (dailyMap[day] !== undefined) {
        dailyMap[day].revenue += u.plan === 'weekly' ? WEEKLY_PRICE : MONTHLY_PRICE
      }
    })

    // Mythos par jour
    const mythosList = mythos30d || []
    mythosList.forEach(m => {
      const day = m.created_at.split('T')[0]
      if (dailyMap[day] !== undefined) {
        dailyMap[day].mythos += 1
      }
    })

    const dailyChartData = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v }))

    return res.status(200).json({
      totalRevenue: +totalRevenue.toFixed(2),
      revenue30d: +revenue30d.toFixed(2),
      revenueGrowth: +revenueGrowth.toFixed(1),
      totalCost: +totalCost.toFixed(2),
      totalMythos,
      netProfit: +netProfit.toFixed(2),
      margin: +margin.toFixed(1),
      activeSubscribers: activeUsers.length,
      weeklySubscribers: weeklyUsers.length,
      monthlySubscribers: monthlyUsers.length,
      newSubscribers30d: (newUsers30d || []).length,
      newSubscribersGrowth: +revenueGrowth.toFixed(1),
      churnRate: +churnRate.toFixed(1),
      churnCount: cancelledCount || 0,
      dailyRevenue: dailyChartData,
      dailyMythos: dailyChartData,
    })
  } catch (e) {
    console.error('Admin dashboard error:', e)
    return res.status(200).json(buildEmpty())
  }
}

function buildEmpty() {
  const now = new Date()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (29 - i))
    return { date: d.toISOString().split('T')[0], revenue: 0, mythos: 0 }
  })
  return {
    totalRevenue: 0, revenue30d: 0, revenueGrowth: 0, totalCost: 0,
    totalMythos: 0, netProfit: 0, margin: 0, activeSubscribers: 0,
    weeklySubscribers: 0, monthlySubscribers: 0, newSubscribers30d: 0,
    newSubscribersGrowth: 0, churnRate: 0, churnCount: 0,
    dailyRevenue: days, dailyMythos: days,
  }
}
