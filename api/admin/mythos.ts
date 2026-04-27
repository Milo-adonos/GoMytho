import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_middleware'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

function getMockMythos() {
  return { mythos: [], total: 0 }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const supabase = getSupabase()
  if (!supabase) return res.status(200).json(getMockMythos())

  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 100

    const { data, count } = await supabase
      .from('mythos')
      .select('id, user_id, prompt, image_url, created_at', { count: 'exact' })
      .range((page - 1) * limit, page * limit - 1)
      .order('created_at', { ascending: false })

    return res.status(200).json({
      mythos: (data || []).map((m: any) => ({ ...m, cost: 0.037 })),
      total: count || 0,
    })
  } catch {
    return res.status(200).json(getMockMythos())
  }
}
