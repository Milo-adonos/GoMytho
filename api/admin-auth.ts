import type { VercelRequest, VercelResponse } from '@vercel/node'
import { serialize } from 'cookie'
import { generateToken, checkRateLimit } from './_middleware'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown'

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 1 heure.' })
  }

  const { password } = req.body || {}

  if (!password) {
    return res.status(400).json({ error: 'Mot de passe requis' })
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Configuration serveur manquante' })
  }

  // Délai anti-brute force
  await new Promise(r => setTimeout(r, 500))

  if (password !== ADMIN_PASSWORD) {
    await new Promise(r => setTimeout(r, 1500))
    return res.status(401).json({ error: 'Accès refusé' })
  }

  const token = generateToken()

  res.setHeader('Set-Cookie', serialize('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 86400,
    path: '/',
  }))

  return res.status(200).json({ success: true })
}
