import type { VercelRequest, VercelResponse } from '@vercel/node'
import axios from 'axios'

// ─────────────────────────────────────────────────────────────────────────────
// Architecture polling : le serveur ne tient JAMAIS la connexion plus de ~30s
// (sinon Vercel timeout = 10s sur Hobby, 60s sur Pro). On expose donc deux
// modes via une seule route :
//
//   POST /api/generate-mytho        → mode: "create" (default si imageUrl|s)
//     body: { userPrompt, imageUrl?, imageUrls?, aspectRatio }
//     → 200 { taskId, status: 'pending' }
//
//   POST /api/generate-mytho        → mode: "poll"
//     body: { mode: 'poll', taskId }
//     → 200 { status: 'pending'|'success'|'failed',
//             imageUrl?, previewDataUrl?, error? }
//
// Le client (src/lib/kie-api.ts) crée la tâche puis poll lui-même → on encaisse
// les générations longues (jusqu'à 3 min) sans perdre la connexion.
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  // Sécurité : on autorise jusqu'à 30s par appel (création OU 1 poll). Aucun
  // appel ne dépasse réellement ces 30s parce que la création répond en ~5s
  // et chaque poll en ~1s.
  maxDuration: 30,
}

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

// ─── Classification des blocages IA → message FR friendly ────────────────────
// Kie.ai retourne des messages anglais peu lisibles ("Request blocked: …
// prominent public figure"). On les mappe vers des messages clairs et
// actionnables pour l'utilisateur final.
function classifyKieBlock(rawMsg: string): { code: string; message: string } | null {
  const m = String(rawMsg || '').toLowerCase()
  if (!m) return null
  if (!/blocked|flagged|policy|guideline|moderation|refused|rejected|not allowed|prohibited|safety/.test(m)) {
    return null
  }
  if (/public figure|celebrity|politician|prominent person|known person/.test(m)) {
    return {
      code: 'CONTENT_BLOCKED_PUBLIC_FIGURE',
      message:
        "Personnalité publique détectée. L'IA refuse de générer des images de célébrités, politiques ou figures publiques connues. Réessaie en utilisant ta propre photo ou un personnage anonyme.",
    }
  }
  if (/nudity|sexual|nsfw|explicit|porn|nude/.test(m)) {
    return {
      code: 'CONTENT_BLOCKED_NSFW',
      message:
        'Contenu sexuel ou nu détecté dans la photo ou le prompt. Reformule avec un contenu autorisé.',
    }
  }
  if (/minor|child|underage|kid|teen/.test(m)) {
    return {
      code: 'CONTENT_BLOCKED_MINOR',
      message:
        "Contenu impliquant un mineur détecté. L'IA refuse cette génération. Utilise une photo d'adulte.",
    }
  }
  if (/violence|gore|harm|blood|weapon|hate/.test(m)) {
    return {
      code: 'CONTENT_BLOCKED_VIOLENCE',
      message: 'Contenu violent ou haineux détecté. Adoucis ton prompt et réessaie.',
    }
  }
  if (/copyright|trademark|brand|logo|intellectual property/.test(m)) {
    return {
      code: 'CONTENT_BLOCKED_COPYRIGHT',
      message:
        'Contenu protégé par copyright détecté (marque, logo, personnage). Reformule sans référence à une marque connue.',
    }
  }
  return {
    code: 'CONTENT_BLOCKED',
    message: 'Génération refusée par les filtres IA. Reformule ton prompt ou change de photo.',
  }
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
      timeout: 15000,
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

// ─── HANDLER ────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.VITE_KIE_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'KIE API key missing on server' })

  const body = (req.body || {}) as Record<string, unknown>
  const mode = String(body.mode || '').toLowerCase()

  // ─── MODE POLL ─────────────────────────────────────────────────────────────
  if (mode === 'poll') {
    const taskId = String(body.taskId || '').trim()
    if (!taskId) return res.status(400).json({ error: 'taskId required for poll' })

    try {
      const { data: pollData } = await axios.get(
        `${KIE_RECORD_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 }
      )

      const inner = (pollData?.data || pollData) as Record<string, unknown>
      const state = String((inner as any)?.state || (inner as any)?.status || '').toLowerCase()

      if (state === 'failed' || state === 'fail' || state === 'error') {
        const rawMsg = String(
          (inner as any)?.failMsg ||
            (inner as any)?.errorMessage ||
            (inner as any)?.error ||
            (inner as any)?.message ||
            ''
        )
        const blocked = classifyKieBlock(rawMsg)
        if (blocked) {
          return res.status(200).json({
            status: 'failed',
            blocked: true,
            code: blocked.code,
            error: blocked.message,
            rawError: rawMsg,
          })
        }
        return res.status(200).json({
          status: 'failed',
          error: rawMsg || 'Kie generation failed',
        })
      }

      if (state === 'success' || state === 'completed' || state === 'succeeded' || state === 'done') {
        const remote = extractKieResultUrl(pollData)
        if (remote) {
          // On télécharge en base64 côté serveur quand c'est rapide (<15s),
          // sinon on retourne juste l'URL (le client la convertira via image-copy).
          const previewDataUrl = await toDataUrlFromUrl(remote)
          return res.status(200).json({
            status: 'success',
            imageUrl: remote,
            previewDataUrl,
          })
        }
        // success state mais sans URL → on signale "still processing"
        return res.status(200).json({ status: 'pending' })
      }

      // pending / queue / running / generating / etc.
      return res.status(200).json({ status: 'pending' })
    } catch (error: any) {
      const status = error?.response?.status
      const providerData = error?.response?.data
      console.error('[generate-mytho] poll error:', { message: error?.message, status, providerData })
      // On retourne pending pour que le client retente automatiquement.
      return res.status(200).json({ status: 'pending', warn: error?.message || 'poll error' })
    }
  }

  // ─── MODE CREATE (default) ─────────────────────────────────────────────────
  try {
    const { userPrompt, imageUrl, imageUrls, aspectRatio } = body as any

    let urls: string[] = []
    if (Array.isArray(imageUrls)) {
      urls = imageUrls.filter((u: unknown): u is string => typeof u === 'string' && !!u)
    }
    if (urls.length === 0 && typeof imageUrl === 'string' && imageUrl) {
      urls = [imageUrl]
    }
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
      timeout: 25000,
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
      // Blocage IA détecté dès la création (Kie répond parfois directement) → 422
      const blocked = classifyKieBlock(msg)
      if (blocked) {
        return res.status(422).json({
          blocked: true,
          code: blocked.code,
          error: blocked.message,
          rawError: msg,
        })
      }
      return res.status(502).json({ error: 'Kie createTask failed', message: msg || `provider error ${code}` })
    }

    const taskId = extractTaskId(createData)
    if (!taskId) {
      return res.status(502).json({ error: 'Kie taskId missing', raw: createData })
    }

    // Réponse rapide : on retourne le taskId, le client polle.
    return res.status(200).json({ taskId, status: 'pending' })
  } catch (error: any) {
    const status = error?.response?.status
    const providerData = error?.response?.data
    console.error('[generate-mytho] create error:', { message: error?.message, status, providerData })
    return res.status(500).json({ error: error?.message || 'Server generation error', status, providerData })
  }
}
