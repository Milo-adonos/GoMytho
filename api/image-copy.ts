import type { VercelRequest, VercelResponse } from '@vercel/node'
import axios from 'axios'

function normalizeImageUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    // Répare les chemins Supabase Storage publics mal encodés
    if (u.pathname.includes('/storage/v1/object/public/')) {
      const marker = '/storage/v1/object/public/'
      const idx = u.pathname.indexOf(marker)
      const suffix = u.pathname.slice(idx + marker.length)
      const repaired = suffix
        .split('/')
        .map((seg) => {
          if (!seg) return seg
          try {
            return encodeURIComponent(decodeURIComponent(seg))
          } catch {
            return encodeURIComponent(seg)
          }
        })
        .join('/')
      u.pathname = `${marker}${repaired}`
      return u.toString()
    }
    return u.toString()
  } catch {
    return rawUrl
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const imageUrl = normalizeImageUrl(String(req.body?.imageUrl || '').trim())
    if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl' })

    if (imageUrl.startsWith('data:image/')) {
      return res.status(200).json({ dataUrl: imageUrl })
    }

    if (!/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({ error: 'Invalid imageUrl' })
    }

    const response = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
    })

    const contentType = String(response.headers['content-type'] || 'image/jpeg')
    const base64 = Buffer.from(response.data).toString('base64')
    const dataUrl = `data:${contentType};base64,${base64}`

    return res.status(200).json({ dataUrl })
  } catch (error: any) {
    return res.status(502).json({
      error: 'Image copy failed',
      details: error?.message || 'Unknown error',
    })
  }
}
