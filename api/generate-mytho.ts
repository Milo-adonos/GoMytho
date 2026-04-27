import type { VercelRequest, VercelResponse } from '@vercel/node'
import axios from 'axios'

type AspectRatio = '9:16' | '16:9'

const KIE_CREATE_ENDPOINT = 'https://api.kie.ai/api/v1/jobs/createTask'
const KIE_RECORD_ENDPOINT = 'https://api.kie.ai/api/v1/jobs/recordInfo'

// ─── Extraction TARGETED — format Kie réel ────────────────────────────────────
function extractKieResultUrl(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== 'object') return null
  const root = rawData as Record<string, unknown>
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>

  const tryParseUrls = (value: unknown): string | null => {
    if (!value) return null
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const arr = obj.resultUrls || (obj as any).result_urls || (obj as any).urls || (obj as any).images
      if (Array.isArray(arr) && typeof arr[0] === 'string') return String(arr[0])
      if (typeof obj.imageUrl === 'string') return obj.imageUrl as string
      if (typeof obj.url === 'string') return obj.url as string
    }
    if (typeof value === 'string') {
      try { return tryParseUrls(JSON.parse(value)) } catch { return null }
    }
    return null
  }

  const fromResultJson = tryParseUrls(data.resultJson)
  if (fromResultJson) return fromResultJson
  const fromResult = tryParseUrls((data as any).result)
  if (fromResult) return fromResult
  const fromOutput = tryParseUrls((data as any).output)
  if (fromOutput) return fromOutput

  for (const k of ['imageUrl', 'image_url', 'resultUrl', 'result_url', 'url']) {
    const v = (data as any)[k]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  }
  return null
}

function extractTaskId(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== 'object') return null
  const root = rawData as Record<string, unknown>
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>
  for (const k of ['taskId', 'task_id', 'recordId', 'record_id', 'id', 'jobId', 'job_id']) {
    const v = (data as any)[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

async function toDataUrlFromUrl(url: string): Promise<string | null> {
  try {
    if (!url) return null
    if (url.startsWith('data:image/')) return url
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      maxRedirects: 5,
    })
    const contentType = String(response.headers['content-type'] || 'image/jpeg')
    const base64 = Buffer.from(response.data).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

function enhancePrompt(userPrompt: string, imageCount: number = 1): string {
  const compositionBlock = imageCount >= 2 ? `

MULTI-IMAGE COMPOSITION RULES:
You receive TWO reference images. Image 1 is the SUBJECT source (the person, object or element to insert). Image 2 is the SCENE source (the destination background, environment or photo where the subject must appear).
Place the subject from image 1 naturally into the scene of image 2, following the user's instruction above.
Preserve the identity, face, body, clothes details and proportions of the subject from image 1 with maximum fidelity.
Adapt the subject to the lighting, shadows, color temperature, perspective, depth and grain of image 2 (the scene). The final image MUST look like the subject was really photographed inside that scene, not pasted.
Reproduce realistic ground contact, occlusions and shadows between the inserted subject and the existing elements of the scene.
Keep the framing/composition of image 2 as the base unless the user asks otherwise.` : ''

  const sceneRef = imageCount >= 2 ? 'destination scene (image 2)' : 'original photo'

  return `${userPrompt}.${compositionBlock}

CRITICAL REALISM REQUIREMENTS:
The result MUST look like a real, unmodified smartphone photo, indistinguishable from a genuine photograph.
Match exact lighting, shadows, perspective, depth of field, image quality and natural imperfections of the ${sceneRef}.
Add realistic shadows and contact points where new/inserted elements touch existing surfaces.

TEXT AND BRAND ACCURACY:
Every letter, number, brand name and logo must be perfectly legible, sharp and 100% accurate. No gibberish, no misspellings.

ANTI-AI DETECTION:
No oversaturated colors, no uncanny smoothness, no perfect symmetry. Photo style: shot on iPhone, casual snapshot, natural lighting, no professional retouching.`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.VITE_KIE_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'KIE API key missing on server' })

  try {
    const { userPrompt, imageUrl, imageUrls, aspectRatio } = req.body || {}

    // Normalisation : on accepte soit `imageUrls` (array), soit `imageUrl` (legacy).
    let urls: string[] = []
    if (Array.isArray(imageUrls)) {
      urls = imageUrls.filter((u: unknown): u is string => typeof u === 'string' && !!u)
    }
    if (urls.length === 0 && typeof imageUrl === 'string' && imageUrl) {
      urls = [imageUrl]
    }
    // Limite haute = 2 (cas image-to-image composition)
    if (urls.length > 2) urls = urls.slice(0, 2)

    if (!userPrompt || urls.length === 0) {
      return res.status(400).json({ error: 'Missing userPrompt/imageUrl' })
    }
    if (aspectRatio !== '9:16' && aspectRatio !== '16:9') {
      return res.status(400).json({ error: 'Invalid aspect ratio' })
    }

    const payload = {
      model: 'nano-banana-2',
      input: {
        prompt: enhancePrompt(String(userPrompt), urls.length),
        image_input: urls,
        aspect_ratio: aspectRatio as AspectRatio,
        resolution: '1K',
        output_format: 'jpg',
      },
    }

    const { data: createData } = await axios.post(KIE_CREATE_ENDPOINT, payload, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    })

    const code = Number(createData?.code ?? 200)
    const msg = String(createData?.msg || createData?.message || '').trim()
    if (code !== 200) {
      const isCredit = code === 402 || /credits?\s+insufficient|balance.*enough|top up/i.test(msg)
      if (isCredit) {
        return res.status(402).json({
          error: 'Kie credits insufficient',
          message: 'Crédits Kie insuffisants. Recharge le solde API Kie.',
        })
      }
      return res.status(502).json({ error: 'Kie createTask failed', message: msg || `provider error ${code}` })
    }

    const taskId = extractTaskId(createData)
    if (!taskId) {
      return res.status(502).json({ error: 'Kie taskId missing', raw: createData })
    }

    // Polling 2s × 90 attempts = 180s max
    const maxAttempts = 90
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000))

      let pollData: any
      try {
        const { data } = await axios.get(
          `${KIE_RECORD_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 }
        )
        pollData = data
      } catch {
        continue
      }

      const inner = (pollData?.data || pollData) as Record<string, unknown>
      const state = String((inner as any)?.state || (inner as any)?.status || '').toLowerCase()

      if (state === 'failed' || state === 'fail' || state === 'error') {
        return res.status(502).json({
          error: (inner as any)?.failMsg || (inner as any)?.error || 'Kie generation failed',
          raw: inner,
        })
      }

      if (state === 'success' || state === 'completed' || state === 'succeeded' || state === 'done') {
        const remote = extractKieResultUrl(pollData)
        if (remote) {
          const previewDataUrl = await toDataUrlFromUrl(remote)
          return res.status(200).json({ imageUrl: remote, previewDataUrl })
        }
        // Sinon on laisse encore le polling tourner
      }
    }

    return res.status(504).json({ error: 'Timeout waiting for Kie task result', taskId })
  } catch (error: any) {
    const status = error?.response?.status
    const providerData = error?.response?.data
    console.error('generate-mytho api error:', { message: error?.message, status, providerData })
    return res.status(500).json({ error: error?.message || 'Server generation error', status, providerData })
  }
}
