import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

// Middleware dev simulant les routes /api/admin en local
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
            const now = new Date()
            const days = Array.from({ length: 30 }, (_, i) => {
              const d = new Date(now); d.setDate(d.getDate() - (29 - i))
              return { date: d.toISOString().split('T')[0], revenue: 0, mythos: 0 }
            })
            res.end(JSON.stringify({ totalRevenue: 0, revenue30d: 0, totalCost: 0, totalMythos: 0, netProfit: 0, margin: 0, activeSubscribers: 0, weeklySubscribers: 0, monthlySubscribers: 0, newSubscribers30d: 0, newSubscribersGrowth: 0, churnRate: 0, churnCount: 0, dailyRevenue: days, dailyMythos: days }))
            return
          }

          if (req.url?.startsWith('/api/admin/users')) {
            res.end(JSON.stringify({ users: [], total: 0 }))
            return
          }

          if (req.url?.startsWith('/api/admin/mythos')) {
            res.end(JSON.stringify({ mythos: [], total: 0 }))
            return
          }

          if (req.url?.startsWith('/api/admin/finance')) {
            const months = ['Nov','Déc','Jan','Fév','Mar','Avr']
            res.end(JSON.stringify({ currentMonth: { revenue: 0, cost: 0, margin: 0, marginPct: 0, mythos: 0, newSubscribers: 0, cancellations: 0, churnRate: 0 }, monthlyData: months.map(month=>({month,revenue:0,cost:0,margin:0})), planSplit: { weekly: 0, monthly: 0 }, topClients: [] }))
            return
          }

          if (req.url?.startsWith('/api/admin/settings')) {
            res.end(JSON.stringify({ costPerImage: 0.037, maintenanceMode: false, notificationEmail: '' }))
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
