import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    ok: true,
    ts: Date.now(),
    node: process.version,
    hasAdminPwd: !!process.env.ADMIN_PASSWORD,
    hasJwtSecret: !!process.env.JWT_SECRET,
  })
}
