import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac } from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_gomytho_2026'
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function generateToken(): string {
  const exp = Date.now() + TOKEN_TTL_MS
  const payload = base64url(JSON.stringify({ role: 'admin', exp }))
  const signature = base64url(createHmac('sha256', JWT_SECRET).update(payload).digest())
  return `${payload}.${signature}`
}

const attempts = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = attempts.get(ip)
  if (!record || now > record.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 3600000 })
    return true
  }
  if (record.count >= 10) return false
  record.count++
  return true
}

function serializeCookie(name: string, value: string, opts: { maxAge: number; secure: boolean }): string {
  const parts = [`${name}=${value}`, `Max-Age=${opts.maxAge}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown'

    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 1 heure.' })
    }

    let body: any = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = {} }
    }
    if (!body || typeof body !== 'object') body = {}

    const password = typeof body.password === 'string' ? body.password.trim() : ''
    if (!password) return res.status(400).json({ error: 'Mot de passe requis' })

    const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'GoMytho@Admin2026!').trim()

    if (password !== ADMIN_PASSWORD) {
      await new Promise(r => setTimeout(r, 1000))
      return res.status(401).json({ error: 'Accès refusé' })
    }

    const token = generateToken()
    res.setHeader('Set-Cookie', serializeCookie('admin_token', token, {
      maxAge: 86400,
      secure: process.env.NODE_ENV === 'production',
    }))

    return res.status(200).json({ success: true })
  } catch (err: any) {
    console.error('[admin-auth] error', err?.message || err, err?.stack)
    return res.status(500).json({ error: 'Erreur serveur', detail: String(err?.message || err) })
  }
}
