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

// ─── Erreur typée pour les blocages de modération IA ────────────────────────
// Permet à l'UI de l'afficher avec un visuel dédié (au lieu d'un alert brut).
export class KieBlockedError extends Error {
  code: string
  rawError?: string
  constructor(code: string, message: string, rawError?: string) {
    super(message)
    this.name = 'KieBlockedError'
    this.code = code
    this.rawError = rawError
  }
}

// Détection côté client (fallback direct Kie.ai) — mêmes règles que api/generate-mytho.ts
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
      message: 'Contenu sexuel ou nu détecté. Reformule avec un contenu autorisé.',
    }
  }
  if (/minor|child|underage|kid|teen/.test(m)) {
    return {
      code: 'CONTENT_BLOCKED_MINOR',
      message: "Contenu impliquant un mineur détecté. L'IA refuse cette génération. Utilise une photo d'adulte.",
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

export interface GenerateMythoParams {
  userPrompt: string
  // Une OU deux images :
  //   - imageUrl seul = édition simple ("ajoute X sur cette photo")
  //   - imageUrls (2 entrées) = composition ("mets le sujet de l'image 1 dans
  //     la scène de l'image 2")
  imageUrl?: string
  imageUrls?: string[]
  aspectRatio: AspectRatio
}

function normalizeImageUrls(p: GenerateMythoParams): string[] {
  if (Array.isArray(p.imageUrls) && p.imageUrls.length > 0) {
    return p.imageUrls.filter((u): u is string => typeof u === 'string' && !!u)
  }
  if (p.imageUrl) return [p.imageUrl]
  return []
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
// `imageCount` permet d'adapter le briefing :
//   - 1 image  → édition de la photo source
//   - 2 images → composition (image 1 = sujet, image 2 = scène cible)
export function enhancePrompt(userPrompt: string, imageCount: number = 1): string {
  const compositionBlock = imageCount >= 2 ? `

MULTI-IMAGE COMPOSITION RULES:
You receive TWO reference images. Image 1 is the SUBJECT source (the person, object or element to insert). Image 2 is the SCENE source (the destination background, environment or photo where the subject must appear).
Place the subject from image 1 naturally into the scene of image 2, following the user's instruction above.
Preserve the identity, face, body, clothes details and proportions of the subject from image 1 with maximum fidelity.
Adapt the subject to the lighting, shadows, color temperature, perspective, depth and grain of image 2 (the scene). The final image MUST look like the subject was really photographed inside that scene, not pasted.
Reproduce realistic ground contact, occlusions and shadows between the inserted subject and the existing elements of the scene.
Keep the framing/composition of image 2 as the base unless the user asks otherwise.` : ''

  return `${userPrompt}.${compositionBlock}

CRITICAL REALISM REQUIREMENTS:
The result MUST look like a real, unmodified smartphone photo, indistinguishable from a genuine photograph.
Match the exact lighting (direction, color temperature, intensity, shadows) of the ${imageCount >= 2 ? 'destination scene (image 2)' : 'original photo'}.
Match the exact image quality, grain and softness of the ${imageCount >= 2 ? 'destination scene (image 2)' : 'original photo'} (do NOT make added/inserted elements sharper than the rest).
Add realistic shadows, contact points, and reflections where new elements touch existing surfaces.
Preserve the ${imageCount >= 2 ? 'scene (image 2) ' : 'original photo\'s '}perspective, depth of field, and camera angle.

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

// ─── HELPER : fetch avec timeout (AbortController) ───────────────────────────
async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  ms: number
): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}

// ─── GÉNÉRATION PRINCIPALE ────────────────────────────────────────────────────
// Architecture : on appelle /api/generate-mytho en 2 phases :
//   1) mode=create → reçoit un taskId rapidement (~5s)
//   2) mode=poll x N → on poll jusqu'à success/failed (chaque appel ~1-2s)
// Aucun appel ne dépasse 30s côté serveur → pas de risque de timeout Vercel.
//
// En cas de fail total côté backend, fallback direct Kie.ai depuis le browser.
//
// Retourne TOUJOURS un data URL base64 prêt à afficher / télécharger.
export async function generateMytho(
  params: GenerateMythoParams,
  onProgress?: (step: string) => void
): Promise<{ remoteUrl: string; dataUrl: string }> {
  const { userPrompt, aspectRatio } = params
  const imageUrls = normalizeImageUrls(params)
  if (imageUrls.length === 0) throw new Error('Aucune photo fournie')

  // ── Phase 1 : création de la tâche via backend ───────────────────────────
  let taskId: string | null = null
  let backendUsable = true
  try {
    onProgress?.('Envoi sécurisé...')
    const { ok, status, data } = await fetchJsonWithTimeout(
      '/api/generate-mytho',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'create',
          userPrompt,
          imageUrl: imageUrls[0],
          imageUrls,
          aspectRatio,
        }),
      },
      30000
    )
    if (status === 402) {
      throw new Error(data?.message || 'Crédits Kie.ai insuffisants. Recharge le solde API.')
    }
    // Blocage modération IA détecté à la création → on ne tente PAS le fallback
    // (Kie le rejettera de la même façon → autant remonter l'erreur tout de suite).
    if (status === 422 && data?.blocked) {
      throw new KieBlockedError(
        String(data?.code || 'CONTENT_BLOCKED'),
        String(data?.error || 'Contenu refusé par les filtres IA.'),
        String(data?.rawError || '')
      )
    }
    if (ok && typeof data?.taskId === 'string' && data.taskId) {
      taskId = data.taskId as string
    } else {
      console.warn('[generateMytho] backend create failed:', { status, data })
      backendUsable = false
    }
  } catch (err) {
    if (err instanceof KieBlockedError) throw err
    if ((err as Error)?.message?.includes('Crédits Kie')) throw err
    console.warn('[generateMytho] backend create exception:', err)
    backendUsable = false
  }

  // ── Phase 2 : polling via backend ────────────────────────────────────────
  if (taskId && backendUsable) {
    const maxAttempts = 90 // 90 × 2s = 180s max
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((r) => setTimeout(r, 2000))
      onProgress?.(`Génération... (${Math.round(((attempt + 1) / maxAttempts) * 100)}%)`)
      try {
        const { ok, data } = await fetchJsonWithTimeout(
          '/api/generate-mytho',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'poll', taskId }),
          },
          25000
        )
        if (!ok) continue
        const status = String(data?.status || 'pending').toLowerCase()
        if (status === 'failed') {
          if (data?.blocked) {
            throw new KieBlockedError(
              String(data?.code || 'CONTENT_BLOCKED'),
              String(data?.error || 'Contenu refusé par les filtres IA.'),
              String(data?.rawError || '')
            )
          }
          throw new Error(`Kie.ai: ${data?.error || 'génération échouée'}`)
        }
        if (status === 'success' && data?.imageUrl) {
          const remote = String(data.imageUrl)
          let dataUrl = String(data.previewDataUrl || '')
          if (!dataUrl) {
            onProgress?.('Copie locale...')
            dataUrl = (await urlToDataUrlClient(remote)) || ''
          }
          if (!dataUrl) throw new Error('Image générée non récupérable')
          onProgress?.('Mytho prêt !')
          return { remoteUrl: remote, dataUrl }
        }
        // sinon: pending → on continue
      } catch (err) {
        // Erreur métier (blocage modération, échec Kie) → on remonte tout de suite.
        if (err instanceof KieBlockedError) throw err
        if ((err as Error)?.message?.includes('Kie.ai:')) throw err
        if (attempt >= maxAttempts - 3) throw err
      }
    }
    throw new Error('Timeout : la génération a dépassé 3 minutes')
  }

  // ── Phase 3 : FALLBACK direct Kie.ai depuis le browser ───────────────────
  if (!KIE_API_KEY) {
    throw new Error('Génération impossible (backend KO et clé API manquante côté client).')
  }
  if (aspectRatio !== '9:16' && aspectRatio !== '16:9') {
    throw new Error(`Aspect ratio invalide : ${aspectRatio}`)
  }

  const enhancedPrompt = enhancePrompt(userPrompt, imageUrls.length)
  const fallbackPayload = {
    model: FIXED_PARAMS.model,
    input: {
      prompt: enhancedPrompt,
      image_input: imageUrls,
      aspect_ratio: aspectRatio,
      resolution: FIXED_PARAMS.resolution,
      output_format: FIXED_PARAMS.output_format,
    },
  }

  onProgress?.('Envoi à l\'IA...')
  const { data: createData } = await axios.post(KIE_CREATE_ENDPOINT, fallbackPayload, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  })

  const code = Number(createData?.code ?? 200)
  const msg = String(createData?.msg || createData?.message || '').trim()
  if (code !== 200) {
    if (code === 402 || /credits?\s+insufficient|balance.*enough|top up/i.test(msg)) {
      throw new Error('Kie.ai: crédits API insuffisants. Recharge le solde Kie.')
    }
    const blocked = classifyKieBlock(msg)
    if (blocked) {
      throw new KieBlockedError(blocked.code, blocked.message, msg)
    }
    throw new Error(`Kie.ai: ${msg || `erreur ${code}`}`)
  }

  const fallbackTaskId = extractTaskId(createData)
  if (!fallbackTaskId) throw new Error('Kie.ai: taskId introuvable')

  const maxAttempts = 90
  let consecutiveErrors = 0
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((r) => setTimeout(r, 2000))
    onProgress?.(`Génération... (${Math.round(((attempt + 1) / maxAttempts) * 100)}%)`)
    try {
      const { data: pollData } = await axios.get(
        `${KIE_RECORD_ENDPOINT}?taskId=${encodeURIComponent(fallbackTaskId)}`,
        { headers: { Authorization: `Bearer ${KIE_API_KEY}` }, timeout: 15000 }
      )
      consecutiveErrors = 0
      const inner = (pollData?.data || pollData) as Record<string, unknown>
      const state = String(inner?.state || inner?.status || '').toLowerCase()
      if (state === 'failed' || state === 'fail' || state === 'error') {
        const rawFail = String(
          (inner as any)?.failMsg ||
            (inner as any)?.errorMessage ||
            (inner as any)?.error ||
            (inner as any)?.message ||
            ''
        )
        const blocked = classifyKieBlock(rawFail)
        if (blocked) throw new KieBlockedError(blocked.code, blocked.message, rawFail)
        throw new Error(`Kie.ai: ${rawFail || 'génération échouée'}`)
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
      }
    } catch (err) {
      if (err instanceof KieBlockedError) throw err
      if ((err as Error)?.message?.startsWith('Kie.ai:')) throw err
      consecutiveErrors += 1
      // 5 échecs réseau d'affilée → on stoppe pour ne pas faire attendre l'utilisateur
      if (consecutiveErrors >= 5) throw err
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
