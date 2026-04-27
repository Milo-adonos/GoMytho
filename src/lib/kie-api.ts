import axios from 'axios'

const KIE_API_KEY = import.meta.env.VITE_KIE_API_KEY
const KIE_CREATE_ENDPOINT = 'https://api.kie.ai/api/v1/jobs/createTask'
const KIE_RECORD_ENDPOINT = 'https://api.kie.ai/api/v1/jobs/recordInfo'

const FIXED_PARAMS = {
  model: 'nano-banana-2',
  resolution: '1K',
  output_format: 'jpg',
} as const

export type AspectRatio = '9:16' | '16:9'

export interface GenerateMythoParams {
  userPrompt: string
  imageUrl: string
  aspectRatio: AspectRatio
}

// ─── EXTRACTION CIBLÉE — FORMAT RÉEL DE KIE.AI ───────────────────────────────
// Réponse Kie:
//   { code:200, msg:"success", data:{ taskId, state:"success",
//       resultJson:'{"resultUrls":["https://..."]}', param:"...echo input...", ... } }
// On lit explicitement resultJson > resultUrls. On NE PARSE JAMAIS le champ param
// (qui contient l'URL source d'entrée, à ne jamais confondre avec le résultat).
function extractKieResultUrl(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== 'object') return null
  const root = rawData as Record<string, unknown>
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>

  const tryParseUrls = (value: unknown): string | null => {
    if (!value) return null
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const arr = obj.resultUrls || obj.result_urls || obj.urls || obj.images
      if (Array.isArray(arr) && typeof arr[0] === 'string') return String(arr[0])
      if (typeof obj.imageUrl === 'string') return obj.imageUrl as string
      if (typeof obj.url === 'string') return obj.url as string
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return tryParseUrls(parsed)
      } catch {
        return null
      }
    }
    return null
  }

  const fromResultJson = tryParseUrls(data.resultJson)
  if (fromResultJson) return fromResultJson
  const fromResult = tryParseUrls((data as any).result)
  if (fromResult) return fromResult
  const fromOutput = tryParseUrls((data as any).output)
  if (fromOutput) return fromOutput

  // Direct fields
  const directKeys = ['imageUrl', 'image_url', 'resultUrl', 'result_url', 'url']
  for (const k of directKeys) {
    const v = data[k]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  }

  return null
}

function extractTaskId(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== 'object') return null
  const root = rawData as Record<string, unknown>
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>
  const directKeys = ['taskId', 'task_id', 'recordId', 'record_id', 'id', 'jobId', 'job_id']
  for (const k of directKeys) {
    const v = data[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

// ─── PROMPT ENHANCER — SAUCE INTERNE INVISIBLE CÔTÉ CLIENT ────────────────────
export function enhancePrompt(userPrompt: string): string {
  return `${userPrompt}.

CRITICAL REALISM REQUIREMENTS:
The result MUST look like a real, unmodified smartphone photo, indistinguishable from a genuine photograph.
Match the exact lighting (direction, color temperature, intensity, shadows) of the original photo.
Match the exact image quality, grain and softness of the original photo (do NOT make added objects sharper than the rest).
Add realistic shadows, contact points, and reflections where new elements touch existing surfaces.
Preserve the original photo's perspective, depth of field, and camera angle.

TEXT AND BRAND ACCURACY:
Every letter, number, brand name and logo must be perfectly legible, sharp and 100% accurate. No gibberish, no misspellings.

ANTI-AI DETECTION:
Avoid the typical "AI look": no oversaturated colors, no uncanny smoothness, no perfect symmetry on faces, no overly clean edges. Preserve natural imperfections (skin pores, fabric texture, ambient noise). Photo style: shot on iPhone, casual snapshot, natural lighting, no professional retouching.`
}

// ─── HELPER: data URL ↔ Blob ──────────────────────────────────────────────────
async function urlToDataUrlClient(url: string): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:image/')) return url
  // 1) Direct fetch (rapide quand CORS OK)
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (res.ok) {
      const blob = await res.blob()
      return await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    }
  } catch {
    /* ignore CORS / network errors → fallback proxy */
  }
  // 2) Proxy serveur (jamais de CORS, toujours base64)
  try {
    const proxyRes = await fetch('/api/image-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: url }),
    })
    if (!proxyRes.ok) return null
    const payload = await proxyRes.json().catch(() => ({}))
    return typeof payload?.dataUrl === 'string' ? payload.dataUrl : null
  } catch {
    return null
  }
}

// ─── GÉNÉRATION PRINCIPALE ────────────────────────────────────────────────────
// Retourne TOUJOURS un data URL base64 prêt à afficher / télécharger.
export async function generateMytho(
  { userPrompt, imageUrl, aspectRatio }: GenerateMythoParams,
  onProgress?: (step: string) => void
): Promise<{ remoteUrl: string; dataUrl: string }> {
  // 1) Backend Vercel — chemin principal
  try {
    onProgress?.('Envoi sécurisé...')
    const response = await fetch('/api/generate-mytho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userPrompt, imageUrl, aspectRatio }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok && (payload?.imageUrl || payload?.previewDataUrl)) {
      const remote = String(payload.imageUrl || payload.previewDataUrl)
      let dataUrl = String(payload.previewDataUrl || '')
      if (!dataUrl) {
        onProgress?.('Copie locale...')
        dataUrl = (await urlToDataUrlClient(remote)) || ''
      }
      if (!dataUrl) throw new Error('Image générée non récupérable')
      onProgress?.('Mytho prêt !')
      return { remoteUrl: remote, dataUrl }
    }
    if (response.status === 402) {
      throw new Error(payload?.message || 'Crédits Kie.ai insuffisants. Recharge le solde API.')
    }
    // Sinon → fallback client direct (404/500/502/503/timeout)
  } catch (err) {
    // On laisse le fallback client tenter sa chance avant de propager
    if ((err as Error)?.message?.includes('Crédits Kie')) throw err
  }

  // 2) Fallback client direct (utilise VITE_KIE_API_KEY)
  if (!KIE_API_KEY) throw new Error('Clé API Kie.ai manquante')
  if (aspectRatio !== '9:16' && aspectRatio !== '16:9') {
    throw new Error(`Aspect ratio invalide : ${aspectRatio}`)
  }

  const enhancedPrompt = enhancePrompt(userPrompt)
  const payload = {
    model: FIXED_PARAMS.model,
    input: {
      prompt: enhancedPrompt,
      image_input: [imageUrl],
      aspect_ratio: aspectRatio,
      resolution: FIXED_PARAMS.resolution,
      output_format: FIXED_PARAMS.output_format,
    },
  }

  onProgress?.('Envoi à l\'IA...')
  const { data: createData } = await axios.post(KIE_CREATE_ENDPOINT, payload, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 60000,
  })

  const code = Number(createData?.code ?? 200)
  const msg = String(createData?.msg || createData?.message || '').trim()
  if (code !== 200) {
    if (code === 402 || /credits?\s+insufficient|balance.*enough|top up/i.test(msg)) {
      throw new Error('Kie.ai: crédits API insuffisants. Recharge le solde Kie.')
    }
    throw new Error(`Kie.ai: ${msg || `erreur ${code}`}`)
  }

  const taskId = extractTaskId(createData)
  if (!taskId) throw new Error('Kie.ai: taskId introuvable')

  // Polling 2s × 90 attempts = 180s max
  const maxAttempts = 90
  const pollInterval = 2000
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollInterval))
    onProgress?.(`Génération... (${Math.round(((attempt + 1) / maxAttempts) * 100)}%)`)
    try {
      const { data: pollData } = await axios.get(
        `${KIE_RECORD_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${KIE_API_KEY}` }, timeout: 30000 }
      )
      const inner = (pollData?.data || pollData) as Record<string, unknown>
      const state = String(inner?.state || inner?.status || '').toLowerCase()
      if (state === 'failed' || state === 'fail' || state === 'error') {
        throw new Error(`Kie.ai: ${inner?.failMsg || inner?.error || 'génération échouée'}`)
      }
      if (state === 'success' || state === 'completed' || state === 'succeeded' || state === 'done') {
        const remote = extractKieResultUrl(pollData)
        if (remote) {
          onProgress?.('Copie locale...')
          const dataUrl = await urlToDataUrlClient(remote)
          if (!dataUrl) throw new Error('Image générée non récupérable côté navigateur')
          onProgress?.('Mytho prêt !')
          return { remoteUrl: remote, dataUrl }
        }
        // Sinon on laisse encore le polling tourner (URL parfois publiée tardivement)
      }
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err
    }
  }
  throw new Error('Timeout : la génération a dépassé 3 minutes')
}

// ─── UPLOAD VERS SUPABASE STORAGE (via API serveur) ───────────────────────────
export async function uploadToSupabase(file: File, userId: string): Promise<string> {
  const { supabase } = await import('./supabase')
  const bucketName = String(import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'

  const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const fileName = `${userId}/${Date.now()}.${fileExt}`
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Session utilisateur introuvable pour upload serveur.')

  const dataUrl = await fileToDataUrl(file)
  const response = await fetch('/api/upload-mytho', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bucketName, fileName, contentType: file.type || 'image/jpeg', dataUrl }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || (!payload?.signedUrl && !payload?.publicUrl)) {
    throw new Error(payload?.error || 'Upload serveur échoué')
  }
  return (payload?.signedUrl || payload?.publicUrl) as string
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Impossible de lire le fichier'))
    reader.readAsDataURL(file)
  })
}

// Compatibilité avec l'ancien nom (legacy: retourne juste l'URL/dataUrl)
export async function generateImage(
  params: GenerateMythoParams,
  onProgress?: (step: string) => void
): Promise<string> {
  const { dataUrl } = await generateMytho(params, onProgress)
  return dataUrl
}
