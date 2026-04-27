import type { VercelRequest, VercelResponse } from '@vercel/node'
import axios from 'axios'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const imageUrl = String(req.body?.imageUrl || '').trim()
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
