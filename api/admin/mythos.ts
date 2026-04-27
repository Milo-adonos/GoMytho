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
  const prompts = [
    'Mets une Rolex sur mon poignet',
    'Ajoute un dinosaure dans le salon',
    'Mets une moustache géante sur mon pote',
    'Transforme ma Peugeot en Lamborghini',
    'Ajoute Drake à côté de moi',
    'Mets un bébé dans mes bras',
  ]
  return {
    mythos: Array.from({ length: 20 }, (_, i) => ({
      id: `mytho-${i + 1}`,
      user_email: `user${(i % 5) + 1}@example.com`,
      prompt: prompts[i % prompts.length],
      image_url: '',
      aspect_ratio: i % 2 === 0 ? '9:16' : '16:9',
      created_at: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
      cost: 0.037,
    })),
    total: 20,
  }
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
