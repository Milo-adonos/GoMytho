import type { VercelRequest, VercelResponse } from '@vercel/node'
import { serialize } from 'cookie'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Set-Cookie', serialize('admin_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  }))
  return res.status(200).json({ success: true })
}
