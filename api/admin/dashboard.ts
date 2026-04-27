import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_middleware'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

function getEmptyData() {
  const now = new Date()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (29 - i))
    return { date: d.toISOString().split('T')[0], revenue: 0, mythos: 0 }
  })
  return {
    totalRevenue: 0, revenue30d: 0, totalCost: 0, totalMythos: 0,
    netProfit: 0, margin: 0, activeSubscribers: 0, weeklySubscribers: 0,
    monthlySubscribers: 0, newSubscribers30d: 0, newSubscribersGrowth: 0,
    churnRate: 0, churnCount: 0, dailyRevenue: days, dailyMythos: days,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const supabase = getSupabase()
  if (!supabase) {
    return res.status(200).json(getEmptyData())
  }

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [
      { count: totalMythos },
      { count: activeSubscribers },
      { count: weeklySubscribers },
      { count: monthlySubscribers },
    ] = await Promise.all([
      supabase.from('mythos').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('plan', 'weekly').eq('subscription_status', 'active'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('plan', 'monthly').eq('subscription_status', 'active'),
    ])

    const COST_PER_IMAGE = 0.037
    const totalCost = (totalMythos || 0) * COST_PER_IMAGE

    return res.status(200).json({
      totalRevenue: 0,
      revenue30d: 0,
      totalCost,
      totalMythos: totalMythos || 0,
      netProfit: -totalCost,
      margin: 0,
      activeSubscribers: activeSubscribers || 0,
      weeklySubscribers: weeklySubscribers || 0,
      monthlySubscribers: monthlySubscribers || 0,
      newSubscribers30d: 0,
      newSubscribersGrowth: 0,
      churnRate: 0,
      churnCount: 0,
      dailyRevenue: [],
      dailyMythos: [],
    })
  } catch {
    return res.status(200).json(getEmptyData())
  }
}
