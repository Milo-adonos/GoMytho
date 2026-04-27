import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_middleware'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

const COST_PER_IMAGE = 0.037

function getMockUsers() {
  return { users: [], total: 0 }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const supabase = getSupabase()
  if (!supabase) return res.status(200).json(getMockUsers())

  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 50
    const search = req.query.search as string
    const plan = req.query.plan as string
    const status = req.query.status as string

    let query = supabase.from('users').select(`
      id, email, plan, subscription_status, created_at,
      mythos(count)
    `, { count: 'exact' })

    if (search) query = query.ilike('email', `%${search}%`)
    if (plan && plan !== 'all') query = query.eq('plan', plan)
    if (status && status !== 'all') query = query.eq('subscription_status', status)

    const { data, count } = await query
      .range((page - 1) * limit, page * limit - 1)
      .order('created_at', { ascending: false })

    const users = (data || []).map((u: any) => ({
      ...u,
      total_mythos: u.mythos?.[0]?.count || 0,
      total_cost_eur: +((u.mythos?.[0]?.count || 0) * COST_PER_IMAGE).toFixed(2),
      total_revenue_eur: 0,
      net_eur: 0,
    }))

    return res.status(200).json({ users, total: count || 0 })
  } catch {
    return res.status(200).json(getMockUsers())
  }
}
