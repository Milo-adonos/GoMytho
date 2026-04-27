import type { VercelRequest, VercelResponse } from '@vercel/node'
import axios from 'axios'

type AspectRatio = '9:16' | '16:9'

const KIE_ENDPOINT = 'https://api.kie.ai/api/v1/jobs/createTask'

function normalizeComparableUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    u.search = ''
    return decodeURIComponent(u.toString())
  } catch {
    return decodeURIComponent(raw)
  }
}

function keepOnlyGeneratedUrl(candidate: string | null, sourceImageUrl: string): string | null {
  if (!candidate) return null
  if (candidate.startsWith('data:image/')) return candidate
  const a = normalizeComparableUrl(candidate)
  const b = normalizeComparableUrl(sourceImageUrl)
  if (a === b) return null
  return candidate
}

async function toDataUrlFromUrl(url: string): Promise<string | null> {
  try {
    if (!url) return null
    if (url.startsWith('data:image/')) return url
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
    })
    const contentType = String(response.headers['content-type'] || 'image/jpeg')
    const base64 = Buffer.from(response.data).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

function extractImageUrlFromAny(input: unknown): string | null {
  const seen = new WeakSet<object>()
  const queue: unknown[] = [input]
  const urlRegex = /https?:\/\/[^\s"'<>]+/g
  const dataUriRegex = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g

  const normalizeUrl = (raw: string): string | null => {
    const s = raw.trim().replace(/^['"]|['"]$/g, '')
    if (!s) return null
    if (s.startsWith('data:image/')) return s
    if (/^https?:\/\//i.test(s)) return s
    if (s.startsWith('//')) return `https:${s}`
    if (s.startsWith('/')) return `https://api.kie.ai${s}`
    if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s)) return `https://${s}`
    return null
  }

  while (queue.length) {
    const current = queue.shift()
    if (!current) continue

    if (typeof current === 'string') {
      try { queue.push(JSON.parse(current)) } catch {}
      try { const decoded = decodeURIComponent(current); if (decoded !== current) queue.push(decoded) } catch {}
      const matches = current.match(urlRegex) || []
      const dataUris = current.match(dataUriRegex) || []
      if (dataUris[0]) return dataUris[0]
      const picked = matches.find((u) =>
        /(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i.test(u) ||
        /(cdn|storage|image|img|media|output|result)/i.test(u)
      )
      if (picked) {
        const normalized = normalizeUrl(picked)
        if (normalized) return normalized
      }
      const maybeSingle = normalizeUrl(current)
      if (maybeSingle && /(png|jpg|jpeg|webp|gif|bmp|image|media|cdn|storage)/i.test(maybeSingle)) return maybeSingle
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
        if (typeof v === 'string') {
          const normalized = normalizeUrl(v)
          if (normalized) return normalized
        }
      }
      const base64Keys = ['b64_json', 'base64', 'imageBase64', 'resultBase64']
      for (const k of base64Keys) {
        const v = obj[k]
        if (typeof v === 'string' && v.length > 1000) {
          return v.startsWith('data:image/')
            ? v
            : `data:image/jpeg;base64,${v}`
        }
      }
      Object.values(obj).forEach((v) => queue.push(v))
    }
  }
  return null
}

function extractTaskIdFromAny(input: unknown): string | null {
  const seen = new WeakSet<object>()
  const queue: unknown[] = [input]
  const idRegex = /\b(task_[a-zA-Z0-9_-]{6,}|job_[a-zA-Z0-9_-]{6,})\b/

  while (queue.length) {
    const current = queue.shift()
    if (!current) continue

    if (typeof current === 'string') {
      try { queue.push(JSON.parse(current)) } catch {}
      const m = current.match(idRegex)
      if (m?.[1]) return m[1]
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
      const keys = ['task_id', 'taskId', 'id', 'job_id', 'jobId', 'record_id', 'recordId']
      for (const k of keys) {
        const v = obj[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
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

    const providerCode = Number(data?.code ?? data?.statusCode ?? 200)
    const providerMsg = String(data?.msg || data?.message || data?.error || '').trim()
    if (providerCode !== 200) {
      const isCreditError =
        providerCode === 402 ||
        /credits?\s+insufficient|balance.*enough|top up/i.test(providerMsg)
      if (isCreditError) {
        return res.status(402).json({
          error: 'Kie credits insufficient',
          message: 'Crédits Kie insuffisants. Recharge le solde API Kie pour générer.',
          providerCode,
          providerMsg,
        })
      }
      return res.status(502).json({
        error: 'Kie createTask failed',
        message: providerMsg || `provider error ${providerCode}`,
        providerCode,
      })
    }

    const taskId = extractTaskIdFromAny(data)

    if (!taskId) {
      return res.status(502).json({
        error: `Kie task_id missing`,
        message: data?.msg || data?.message || data?.error || 'unknown error',
        raw: data,
      })
    }

    const maxAttempts = 120
    let bestEffortUrl: string | null = null
    let successWithoutUrlCount = 0

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
      const maybeUrl = keepOnlyGeneratedUrl(extractImageUrlFromAny(normalized), String(imageUrl))
      if (maybeUrl) bestEffortUrl = maybeUrl

      if (status === 'completed' || status === 'succeeded' || status === 'success' || status === 'done') {
        const imageUrlOut = maybeUrl || bestEffortUrl
        if (imageUrlOut) {
          const previewDataUrl = await toDataUrlFromUrl(imageUrlOut)
          return res.status(200).json({ imageUrl: imageUrlOut, previewDataUrl })
        }
        successWithoutUrlCount += 1
        if (successWithoutUrlCount < 15) continue
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
    const status = error?.response?.status
    const providerData = error?.response?.data
    console.error('generate-mytho api error:', {
      message: error?.message || error,
      status,
      providerData,
    })
    return res.status(500).json({
      error: error?.message || 'Server generation error',
      status,
      providerData,
    })
  }
}
