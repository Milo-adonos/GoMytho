import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const WEEKLY_PRICE = 2.99
const MONTHLY_PRICE = 9.90
const COST_PER_IMAGE = 0.037
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_gomytho_2026'

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function signPayload(payload: string): string {
  return createHmac('sha256', JWT_SECRET).update(payload).digest('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function verifyAdmin(req: VercelRequest): boolean {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies.admin_token
    if (!token) return false
    const [payloadB64, signature] = token.split('.')
    if (!payloadB64 || !signature) return false
    const expected = signPayload(payloadB64)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    if (!timingSafeEqual(a, b)) return false
    const data = JSON.parse(fromBase64url(payloadB64).toString('utf8'))
    return data?.role === 'admin' && typeof data.exp === 'number' && Date.now() < data.exp
  } catch {
    return false
  }
}

function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!verifyAdmin(req)) {
    res.status(401).json({ error: 'Non autorisé' })
    return false
  }
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const action = String(req.query.action || '').toLowerCase()

  try {
    switch (action) {
      case 'dashboard': return await handleDashboard(res)
      case 'finance': return await handleFinance(res)
      case 'mythos': return await handleMythos(req, res)
      case 'users': return await handleUsers(req, res)
      case 'settings': return await handleSettings(req, res)
      case 'migrate': return await handleMigrate(res)
      default:
        return res.status(404).json({ error: 'Action inconnue' })
    }
  } catch (e: any) {
    console.error(`[admin/${action}] error`, e?.message || e)
    return res.status(200).json(emptyForAction(action))
  }
}

function emptyForAction(action: string) {
  switch (action) {
    case 'dashboard': return buildEmptyDashboard()
    case 'finance': return buildEmptyFinance()
    case 'mythos': return { mythos: [], total: 0 }
    case 'users': return { users: [], total: 0 }
    case 'settings': return { costPerImage: COST_PER_IMAGE, maintenanceMode: false, notificationEmail: '' }
    default: return {}
  }
}

async function handleDashboard(res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(200).json(buildEmptyDashboard())

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

  const weeklyRevenue = weeklyUsers.length * WEEKLY_PRICE * 4.33
  const monthlyRevenue = monthlyUsers.length * MONTHLY_PRICE
  const totalRevenue = weeklyRevenue + monthlyRevenue

  const revenue30d = (newUsers30d || []).reduce((acc, u) => {
    return acc + (u.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE)
  }, 0)

  const prevRevenue30d = (newUsersPrev30d || []).length * MONTHLY_PRICE
  const revenueGrowth = prevRevenue30d > 0 ? ((revenue30d - prevRevenue30d) / prevRevenue30d) * 100 : 0

  const totalMythos = (allMythos || []).length
  const totalCost = totalMythos * COST_PER_IMAGE
  const netProfit = totalRevenue - totalCost
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  const totalActiveUsers = users.filter(u => u.subscription_status !== 'inactive').length
  const churnRate = totalActiveUsers > 0 ? ((cancelledCount || 0) / totalActiveUsers) * 100 : 0

  const dailyMap: Record<string, { revenue: number; mythos: number }> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i)
    dailyMap[d.toISOString().split('T')[0]] = { revenue: 0, mythos: 0 }
  }
  ;(newUsers30d || []).forEach(u => {
    const day = u.created_at.split('T')[0]
    if (dailyMap[day] !== undefined) dailyMap[day].revenue += u.plan === 'weekly' ? WEEKLY_PRICE : MONTHLY_PRICE
  })
  ;(mythos30d || []).forEach(m => {
    const day = m.created_at.split('T')[0]
    if (dailyMap[day] !== undefined) dailyMap[day].mythos += 1
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
}

function buildEmptyDashboard() {
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

async function handleFinance(res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(200).json(buildEmptyFinance())

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  const [{ data: allUsers }, { data: allMythos }] = await Promise.all([
    supabase.from('users').select('id, plan, subscription_status, created_at, email'),
    supabase.from('mythos').select('id, user_id, created_at'),
  ])

  const users = (allUsers || []) as Array<{ id: string; plan?: string; subscription_status?: string; created_at: string; email?: string }>
  const mythos = (allMythos || []) as Array<{ id: string; user_id: string; created_at: string }>

  const activeUsers = users.filter(u => u.subscription_status === 'active')
  const weeklyCount = activeUsers.filter(u => u.plan === 'weekly').length
  const monthlyCount = activeUsers.filter(u => u.plan === 'monthly').length

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
}

function buildEmptyFinance() {
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

async function handleMythos(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(200).json({ mythos: [], total: 0 })

  const page = parseInt(req.query.page as string) || 1
  const limit = parseInt(req.query.limit as string) || 100

  const { data, count } = await supabase
    .from('mythos')
    .select('id, user_id, prompt, image_url, created_at', { count: 'exact' })
    .range((page - 1) * limit, page * limit - 1)
    .order('created_at', { ascending: false })

  return res.status(200).json({
    mythos: (data || []).map((m: any) => ({ ...m, cost: COST_PER_IMAGE })),
    total: count || 0,
  })
}

async function handleUsers(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(200).json({ users: [], total: 0 })

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
}

async function handleSettings(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      costPerImage: COST_PER_IMAGE,
      maintenanceMode: false,
      notificationEmail: '',
    })
  }
  if (req.method === 'POST') {
    return res.status(200).json({ success: true })
  }
  return res.status(405).json({ error: 'Méthode non autorisée' })
}

// ─── Backfill historique : Storage manifests → table SQL public.mythos ───────
//
// Pour chaque manifeste {uid}/index.json présent dans le bucket :
//   1. Si l'utilisateur existe en DB et est resté à plan='free'/inactive
//      (ancien flow buggé) ET qu'il a au moins 1 mytho → on le passe en
//      plan='monthly' / subscription_status='active' (estimation raisonnable).
//   2. Pour chaque mytho du manifeste, on upsert la ligne en SQL avec une
//      URL signée 7 jours.
//
// Ce endpoint peut être rejoué sans risque (idempotent grâce aux upsert).
async function handleMigrate(res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase non configuré' })

  const bucket = String(process.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'
  // 1 an (max Supabase) pour que les images restent visibles longtemps
  const SIGNED_URL_TTL = 60 * 60 * 24 * 365

  let usersFixed = 0
  let mythosImported = 0
  let mythosSkipped = 0
  const errors: string[] = []

  try {
    // 1. Lister tous les "dossiers" (= UID) dans le bucket
    const { data: folders, error: listErr } = await supabase.storage.from(bucket).list('', { limit: 1000 })
    if (listErr) {
      return res.status(500).json({ error: `Lecture bucket impossible: ${listErr.message}` })
    }

    for (const folder of folders || []) {
      // On ne traite que les "vrais" dossiers (UID Supabase, pas de fichier à la racine)
      if (!folder.name || folder.name.includes('.')) continue
      const uid = folder.name

      // 2. Télécharger le manifeste de cet utilisateur
      const manifestPath = `${uid}/index.json`
      const { data: manifestBlob, error: dlErr } = await supabase.storage.from(bucket).download(manifestPath)
      if (dlErr || !manifestBlob) continue

      let manifest: { entries?: any[] } = {}
      try {
        manifest = JSON.parse(await manifestBlob.text())
      } catch {
        continue
      }
      const entries = Array.isArray(manifest.entries) ? manifest.entries : []
      if (entries.length === 0) continue

      // 3. Reconstituer chaque mytho dans public.mythos
      for (const entry of entries) {
        if (!entry?.id || !entry?.image_path || !entry?.prompt) {
          mythosSkipped++
          continue
        }
        try {
          let imageUrl: string | null = null
          if (/^https?:\/\//.test(entry.image_path)) {
            imageUrl = entry.image_path
          } else {
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(entry.image_path, SIGNED_URL_TTL)
            imageUrl = signed?.signedUrl || null
            if (!imageUrl) {
              const { data: pub } = supabase.storage.from(bucket).getPublicUrl(entry.image_path)
              imageUrl = pub?.publicUrl || null
            }
          }
          if (!imageUrl) { mythosSkipped++; continue }

          const { error: upErr } = await supabase.from('mythos').upsert(
            [{
              id: entry.id,
              user_id: uid,
              image_url: imageUrl,
              prompt: String(entry.prompt),
              created_at: entry.created_at || new Date().toISOString(),
            }],
            { onConflict: 'id' }
          )
          if (upErr) {
            mythosSkipped++
            errors.push(`mytho ${entry.id}: ${upErr.message}`)
          } else {
            mythosImported++
          }
        } catch (e: any) {
          mythosSkipped++
          errors.push(`mytho ${entry.id}: ${e?.message || 'erreur inconnue'}`)
        }
      }

      // 4. Si le user a des mythos mais est resté en plan='free' / inactive,
      //    on l'active avec un plan mensuel par défaut (estimation prudente).
      try {
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, plan, subscription_status, credits_remaining')
          .eq('id', uid)
          .single()

        if (dbUser) {
          const isUninitialized =
            dbUser.subscription_status !== 'active' ||
            dbUser.plan === 'free' ||
            (dbUser.credits_remaining ?? 0) === 0

          if (isUninitialized) {
            const remaining = Math.max(560 - entries.length * 8, 0)
            await supabase.from('users').update({
              plan: 'monthly',
              subscription_status: 'active',
              credits_remaining: remaining,
            }).eq('id', uid)
            usersFixed++
          }
        }
      } catch (e: any) {
        errors.push(`user ${uid}: ${e?.message || 'erreur inconnue'}`)
      }
    }

    return res.status(200).json({
      ok: true,
      usersFixed,
      mythosImported,
      mythosSkipped,
      foldersScanned: (folders || []).length,
      errors: errors.slice(0, 20),
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Migration échouée' })
  }
}
