import type { VercelRequest, VercelResponse } from '@vercel/node'
import axios from 'axios'

type AspectRatio = '9:16' | '16:9'

const KIE_ENDPOINT = 'https://api.kie.ai/api/v1/jobs/createTask'

function extractImageUrlFromAny(input: unknown): string | null {
  const seen = new WeakSet<object>()
  const queue: unknown[] = [input]
  const urlRegex = /https?:\/\/[^\s"'<>]+/g

  while (queue.length) {
    const current = queue.shift()
    if (!current) continue

    if (typeof current === 'string') {
      try { queue.push(JSON.parse(current)) } catch {}
      const matches = current.match(urlRegex) || []
      const picked = matches.find((u) =>
        /(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i.test(u) ||
        /(cdn|storage|image|img|media|output|result)/i.test(u)
      )
      if (picked) return picked
      continue
    }

    if (Array.isArray(current)) {
      current.forEach((v) => queue.push(v))
      continue
    }

    if (typeof current === 'object') {
      const obj = current as Record<string, unknown>
      if (seen.has(obj)) continue
      seen.add(obj)
      const keys = ['image_url', 'imageUrl', 'url', 'output_url', 'result_url', 'download_url']
      for (const k of keys) {
        const v = obj[k]
        if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
      }
      Object.values(obj).forEach((v) => queue.push(v))
    }
  }
  return null
}

function enhancePrompt(userPrompt: string): string {
  return `${userPrompt}.

CRITICAL REALISM REQUIREMENTS:
The result MUST look like a real, unmodified smartphone photo.
Match exact lighting, shadows, perspective, depth of field, image quality and natural imperfections.
No fake-looking artifacts, no oversaturated colors, no uncanny smoothness.
`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.VITE_KIE_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'KIE API key missing on server' })
  }

  try {
    const { userPrompt, imageUrl, aspectRatio } = req.body || {}
    if (!userPrompt || !imageUrl) {
      return res.status(400).json({ error: 'Missing userPrompt/imageUrl' })
    }
    if (aspectRatio !== '9:16' && aspectRatio !== '16:9') {
      return res.status(400).json({ error: 'Invalid aspect ratio' })
    }

    const payload = {
      model: 'nano-banana-2',
      input: {
        prompt: enhancePrompt(String(userPrompt)),
        image_input: [String(imageUrl)],
        aspect_ratio: aspectRatio as AspectRatio,
        resolution: '1K',
        output_format: 'jpg',
      },
    }

    const { data } = await axios.post(KIE_ENDPOINT, payload, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    })

    const taskId: string =
      data?.task_id || data?.id || data?.taskId || data?.data?.task_id || data?.data?.id || data?.data?.taskId

    if (!taskId) {
      return res.status(502).json({ error: `Kie task_id missing`, raw: data })
    }

    const maxAttempts = 120
    let bestEffortUrl: string | null = null

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000))

      let result: any
      try {
        const response = await axios.get(
          `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 }
        )
        result = response.data
      } catch {
        const response = await axios.get(
          `https://api.kie.ai/api/v1/jobs/${encodeURIComponent(taskId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 }
        )
        result = response.data
      }

      const normalized = result?.data || result
      const status: string = normalized?.state || normalized?.status || normalized?.task_status
      const maybeUrl = extractImageUrlFromAny(normalized)
      if (maybeUrl) bestEffortUrl = maybeUrl

      if (status === 'completed' || status === 'succeeded' || status === 'success' || status === 'done') {
        const imageUrlOut = maybeUrl || bestEffortUrl
        if (imageUrlOut) return res.status(200).json({ imageUrl: imageUrlOut })
        return res.status(502).json({ error: 'Image URL not found', raw: normalized })
      }

      if (status === 'failed' || status === 'error' || status === 'fail') {
        return res.status(502).json({ error: normalized?.error || normalized?.message || 'Kie task failed', raw: normalized })
      }
    }

    if (bestEffortUrl) {
      return res.status(200).json({ imageUrl: bestEffortUrl, fallback: true })
    }

    return res.status(504).json({ error: 'Timeout waiting for Kie task result', taskId })
  } catch (error: any) {
    console.error('generate-mytho api error:', error?.message || error)
    return res.status(500).json({ error: error?.message || 'Server generation error' })
  }
}
