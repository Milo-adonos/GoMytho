import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

const WEEKLY_PRICE = 2.99
const MONTHLY_PRICE = 9.90
const COST_PER_IMAGE = 0.037
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

async function getSupabaseClient() {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const url = process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!url || !key) return null
    return createClient(url, key)
  } catch {
    return null
  }
}

function buildEmptyDashboard() {
  const now = new Date()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (29 - i))
    return { date: d.toISOString().split('T')[0], revenue: 0, mythos: 0 }
  })
  return { totalRevenue: 0, revenue30d: 0, revenueGrowth: 0, totalCost: 0, totalMythos: 0, netProfit: 0, margin: 0, activeSubscribers: 0, weeklySubscribers: 0, monthlySubscribers: 0, newSubscribers30d: 0, newSubscribersGrowth: 0, churnRate: 0, churnCount: 0, dailyRevenue: days, dailyMythos: days }
}

function buildEmptyFinance() {
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { month: MONTH_LABELS[m.getMonth()], revenue: 0, cost: 0, margin: 0 }
  })
  return { currentMonth: { revenue: 0, cost: 0, margin: 0, marginPct: 0, mythos: 0, newSubscribers: 0, cancellations: 0, churnRate: 0 }, monthlyData: months, planSplit: { weekly: 0, monthly: 0 }, topClients: [] }
}

async function getDashboardData() {
  const supabase = await getSupabaseClient()
  if (!supabase) return buildEmptyDashboard()
  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30)
    const sixtyDaysAgo = new Date(now); sixtyDaysAgo.setDate(now.getDate() - 60)
    const [{ data: allUsers }, { data: newUsers30d }, { data: newUsersPrev30d }, { data: mythos30d }, { data: allMythos }, { count: cancelledCount }] = await Promise.all([
      supabase.from('users').select('id, plan, subscription_status, created_at'),
      supabase.from('users').select('id, plan, created_at').gte('created_at', thirtyDaysAgo.toISOString()).eq('subscription_status', 'active'),
      supabase.from('users').select('id').gte('created_at', sixtyDaysAgo.toISOString()).lt('created_at', thirtyDaysAgo.toISOString()).eq('subscription_status', 'active'),
      supabase.from('mythos').select('id, created_at').gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('mythos').select('id, created_at'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('subscription_status', 'cancelled'),
    ])
    const users = allUsers || []
    const activeUsers = users.filter((u: any) => u.subscription_status === 'active')
    const weeklyUsers = activeUsers.filter((u: any) => u.plan === 'weekly')
    const monthlyUsers = activeUsers.filter((u: any) => u.plan === 'monthly')
    const weeklyRevenue = weeklyUsers.length * WEEKLY_PRICE * 4.33
    const monthlyRevenue = monthlyUsers.length * MONTHLY_PRICE
    const totalRevenue = weeklyRevenue + monthlyRevenue
    const revenue30d = (newUsers30d || []).reduce((acc: number, u: any) => acc + (u.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE), 0)
    const prevRevenue30d = (newUsersPrev30d || []).length * MONTHLY_PRICE
    const revenueGrowth = prevRevenue30d > 0 ? ((revenue30d - prevRevenue30d) / prevRevenue30d) * 100 : 0
    const totalMythos = (allMythos || []).length
    const totalCost = totalMythos * COST_PER_IMAGE
    const netProfit = totalRevenue - totalCost
    const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
    const totalActiveUsers = users.filter((u: any) => u.subscription_status !== 'inactive').length
    const churnRate = totalActiveUsers > 0 ? ((cancelledCount || 0) / totalActiveUsers) * 100 : 0
    const dailyMap: Record<string, { revenue: number; mythos: number }> = {}
    for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); dailyMap[d.toISOString().split('T')[0]] = { revenue: 0, mythos: 0 } }
    const newUsersList = newUsers30d || []
    newUsersList.forEach((u: any) => { const day = u.created_at.split('T')[0]; if (dailyMap[day]) dailyMap[day].revenue += u.plan === 'weekly' ? WEEKLY_PRICE : MONTHLY_PRICE })
    const mythosList = mythos30d || []
    mythosList.forEach((m: any) => { const day = m.created_at.split('T')[0]; if (dailyMap[day]) dailyMap[day].mythos += 1 })
    const dailyChartData = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v }))
    return { totalRevenue: +totalRevenue.toFixed(2), revenue30d: +revenue30d.toFixed(2), revenueGrowth: +revenueGrowth.toFixed(1), totalCost: +totalCost.toFixed(2), totalMythos, netProfit: +netProfit.toFixed(2), margin: +margin.toFixed(1), activeSubscribers: activeUsers.length, weeklySubscribers: weeklyUsers.length, monthlySubscribers: monthlyUsers.length, newSubscribers30d: (newUsers30d || []).length, newSubscribersGrowth: +revenueGrowth.toFixed(1), churnRate: +churnRate.toFixed(1), churnCount: cancelledCount || 0, dailyRevenue: dailyChartData, dailyMythos: dailyChartData }
  } catch (e) { console.error('[DEV] dashboard error:', e); return buildEmptyDashboard() }
}

async function getFinanceData() {
  const supabase = await getSupabaseClient()
  if (!supabase) return buildEmptyFinance()
  try {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth()
    const [{ data: allUsers }, { data: allMythos }] = await Promise.all([
      supabase.from('users').select('id, email, plan, subscription_status, created_at'),
      supabase.from('mythos').select('id, user_id, created_at'),
    ])
    const users = allUsers || []
    const mythos = allMythos || []
    const activeUsers = users.filter((u: any) => u.subscription_status === 'active')
    const weeklyCount = activeUsers.filter((u: any) => u.plan === 'weekly').length
    const monthlyCount = activeUsers.filter((u: any) => u.plan === 'monthly').length
    const startOfMonth = new Date(currentYear, currentMonth, 1)
    const newThisMonth = users.filter((u: any) => u.subscription_status === 'active' && new Date(u.created_at) >= startOfMonth)
    const mythosThisMonth = mythos.filter((m: any) => new Date(m.created_at) >= startOfMonth)
    const cancelledThisMonth = users.filter((u: any) => u.subscription_status === 'cancelled' && new Date(u.created_at) >= startOfMonth)
    const revenueThisMonth = newThisMonth.reduce((acc: number, u: any) => acc + (u.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE), 0)
    const costThisMonth = mythosThisMonth.length * COST_PER_IMAGE
    const marginThisMonth = revenueThisMonth - costThisMonth
    const marginPct = revenueThisMonth > 0 ? (marginThisMonth / revenueThisMonth) * 100 : 0
    const totalActiveMonth = users.filter((u: any) => u.subscription_status !== 'inactive').length
    const churnRate = totalActiveMonth > 0 ? (cancelledThisMonth.length / totalActiveMonth) * 100 : 0
    const monthlyData = []
    for (let i = 5; i >= 0; i--) {
      const m = new Date(currentYear, currentMonth - i, 1)
      const mEnd = new Date(currentYear, currentMonth - i + 1, 1)
      const label = MONTH_LABELS[m.getMonth()]
      const newInMonth = users.filter((u: any) => u.subscription_status === 'active' && new Date(u.created_at) >= m && new Date(u.created_at) < mEnd)
      const mythosInMonth = mythos.filter((mt: any) => new Date(mt.created_at) >= m && new Date(mt.created_at) < mEnd)
      const rev = newInMonth.reduce((acc: number, u: any) => acc + (u.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE), 0)
      const cost = mythosInMonth.length * COST_PER_IMAGE
      monthlyData.push({ month: label, revenue: +rev.toFixed(2), cost: +cost.toFixed(2), margin: +(rev - cost).toFixed(2) })
    }
    const mythosByUser: Record<string, number> = {}
    mythos.forEach((m: any) => { mythosByUser[m.user_id] = (mythosByUser[m.user_id] || 0) + 1 })
    const topClients = Object.entries(mythosByUser).sort(([, a], [, b]) => b - a).slice(0, 5).map(([userId, count]) => {
      const user = users.find((u: any) => u.id === userId)
      const rev = user?.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE
      return { email: user?.email || userId.slice(0, 8) + '...', plan: user?.plan || 'unknown', mythos: count, revenue: +rev.toFixed(2), cost: +(count * COST_PER_IMAGE).toFixed(2) }
    })
    return { currentMonth: { revenue: +revenueThisMonth.toFixed(2), cost: +costThisMonth.toFixed(2), margin: +marginThisMonth.toFixed(2), marginPct: +marginPct.toFixed(1), mythos: mythosThisMonth.length, newSubscribers: newThisMonth.length, cancellations: cancelledThisMonth.length, churnRate: +churnRate.toFixed(1) }, monthlyData, planSplit: { weekly: weeklyCount, monthly: monthlyCount }, topClients }
  } catch (e) { console.error('[DEV] finance error:', e); return buildEmptyFinance() }
}

function adminDevApiPlugin() {
  return {
    name: 'admin-dev-api',
    configureServer(server: any) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method === 'POST' && req.url === '/api/admin-auth') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { password } = JSON.parse(body)
              const adminPwd = process.env.ADMIN_PASSWORD || 'GoMytho@Admin2026!'
              if (password === adminPwd) {
                res.setHeader('Content-Type', 'application/json')
                res.setHeader('Set-Cookie', `admin_token=dev_token_valid; Path=/; Max-Age=86400`)
                res.end(JSON.stringify({ success: true }))
              } else {
                res.statusCode = 401
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Accès refusé' }))
              }
            } catch {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Requête invalide' }))
            }
          })
          return
        }

        if (req.method === 'POST' && req.url === '/api/admin-logout') {
          res.setHeader('Set-Cookie', `admin_token=; Path=/; Max-Age=0`)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: true }))
          return
        }

        if (req.method === 'POST' && req.url === '/api/stripe-portal') {
          res.setHeader('Content-Type', 'application/json')
          // En local, simule l'URL de portail Stripe
          const url = process.env.VITE_STRIPE_PORTAL_URL || 'https://billing.stripe.com/p/login'
          res.end(JSON.stringify({ url }))
          return
        }

        if (req.method === 'POST' && req.url === '/api/image-copy') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', async () => {
            try {
              const { imageUrl } = JSON.parse(body || '{}')
              const target = String(imageUrl || '').trim()
              if (!/^https?:\/\//i.test(target) && !target.startsWith('data:image/')) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Invalid imageUrl' }))
                return
              }

              if (target.startsWith('data:image/')) {
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ dataUrl: target }))
                return
              }

              const fetched = await fetch(target)
              if (!fetched.ok) {
                res.statusCode = 502
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: `Fetch failed: ${fetched.status}` }))
                return
              }
              const contentType = fetched.headers.get('content-type') || 'image/jpeg'
              const arr = await fetched.arrayBuffer()
              const base64 = Buffer.from(arr).toString('base64')
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ dataUrl: `data:${contentType};base64,${base64}` }))
            } catch {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Image copy failed' }))
            }
          })
          return
        }

        if (req.url?.startsWith('/api/admin/')) {
          const cookies = req.headers.cookie || ''
          if (!cookies.includes('admin_token=dev_token_valid')) {
            res.statusCode = 401
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Non autorisé' }))
            return
          }

          res.setHeader('Content-Type', 'application/json')

          if (req.url === '/api/admin/dashboard') {
            const data = await getDashboardData()
            res.end(JSON.stringify(data))
            return
          }

          if (req.url?.startsWith('/api/admin/users')) {
            const supabase = await getSupabaseClient()
            if (!supabase) { res.end(JSON.stringify({ users: [], total: 0 })); return }
            try {
              const { data, count } = await supabase.from('users').select('id, email, plan, subscription_status, created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(50)
              const users = (data || []).map((u: any) => ({ ...u, total_mythos: 0, total_cost_eur: 0, total_revenue_eur: u.plan === 'weekly' ? +(WEEKLY_PRICE * 4.33).toFixed(2) : MONTHLY_PRICE, net_eur: 0 }))
              res.end(JSON.stringify({ users, total: count || 0 }))
            } catch { res.end(JSON.stringify({ users: [], total: 0 })) }
            return
          }

          if (req.url?.startsWith('/api/admin/mythos')) {
            const supabase = await getSupabaseClient()
            if (!supabase) { res.end(JSON.stringify({ mythos: [], total: 0 })); return }
            try {
              const { data, count } = await supabase.from('mythos').select('id, user_id, prompt, image_url, created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(100)
              res.end(JSON.stringify({ mythos: (data || []).map((m: any) => ({ ...m, cost: COST_PER_IMAGE })), total: count || 0 }))
            } catch { res.end(JSON.stringify({ mythos: [], total: 0 })) }
            return
          }

          if (req.url?.startsWith('/api/admin/finance')) {
            const data = await getFinanceData()
            res.end(JSON.stringify(data))
            return
          }

          if (req.url?.startsWith('/api/admin/settings')) {
            res.end(JSON.stringify({ costPerImage: COST_PER_IMAGE, maintenanceMode: false, notificationEmail: '' }))
            return
          }
        }

        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), adminDevApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
})
