import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac, timingSafeEqual } from 'crypto'
import { parse } from 'cookie'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_gomytho_2026'
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(payload: string): string {
  return base64url(createHmac('sha256', JWT_SECRET).update(payload).digest())
}

export function generateToken(): string {
  const exp = Date.now() + TOKEN_TTL_MS
  const payload = base64url(JSON.stringify({ role: 'admin', exp }))
  const signature = sign(payload)
  return `${payload}.${signature}`
}

function verifyToken(token: string): boolean {
  try {
    const [payloadB64, signature] = token.split('.')
    if (!payloadB64 || !signature) return false
    const expected = sign(payloadB64)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    if (!timingSafeEqual(a, b)) return false
    const data = JSON.parse(fromBase64url(payloadB64).toString('utf8')) as { role?: string; exp?: number }
    if (data.role !== 'admin') return false
    if (typeof data.exp !== 'number' || Date.now() >= data.exp) return false
    return true
  } catch {
    return false
  }
}

export function verifyAdmin(req: VercelRequest): boolean {
  try {
    const cookies = parse(req.headers.cookie || '')
    const token = cookies.admin_token
    if (!token) return false
    return verifyToken(token)
  } catch {
    return false
  }
}

export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!verifyAdmin(req)) {
    res.status(401).json({ error: 'Non autorisé' })
    return false
  }
  return true
}

const attempts = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(ip: string): boolean {
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
