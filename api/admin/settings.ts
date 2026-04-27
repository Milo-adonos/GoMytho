import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_middleware'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  if (req.method === 'GET') {
    return res.status(200).json({
      costPerImage: 0.037,
      maintenanceMode: false,
      notificationEmail: '',
    })
  }

  if (req.method === 'POST') {
    // Dans un vrai projet : persister en Supabase
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Méthode non autorisée' })
}
