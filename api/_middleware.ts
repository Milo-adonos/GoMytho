import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { parse } from 'cookie'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret'

export function verifyAdmin(req: VercelRequest): boolean {
  try {
    const cookies = parse(req.headers.cookie || '')
    const token = cookies.admin_token
    if (!token) return false
    jwt.verify(token, JWT_SECRET)
    return true
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

export function generateToken(): string {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' })
}

// Rate limiting simple en mémoire
const attempts = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = attempts.get(ip)
  if (!record || now > record.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 3600000 })
    return true
  }
  if (record.count >= 5) return false
  record.count++
  return true
}
