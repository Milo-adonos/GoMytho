import type { VercelRequest, VercelResponse } from '@vercel/node'
import { serialize } from 'cookie'
import { generateToken, checkRateLimit } from './_auth'

function parseBody(raw: unknown): any {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'OPTIONS') {
      return res.status(200).end()
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Méthode non autorisée' })
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown'

    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 1 heure.' })
    }

    const body = parseBody(req.body)
    const password = body?.password
    const normalizedPassword = typeof password === 'string' ? password.trim() : ''

    if (!normalizedPassword) {
      return res.status(400).json({ error: 'Mot de passe requis' })
    }

    const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'GoMytho@Admin2026!').trim()

    if (normalizedPassword !== ADMIN_PASSWORD) {
      await new Promise(r => setTimeout(r, 1000))
      return res.status(401).json({ error: 'Accès refusé' })
    }

    const token = generateToken()

    res.setHeader('Set-Cookie', serialize('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400,
      path: '/',
    }))

    return res.status(200).json({ success: true })
  } catch (err: any) {
    console.error('[admin-auth] error', err?.message || err)
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}
