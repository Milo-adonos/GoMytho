import axios from 'axios'

const KIE_API_KEY = import.meta.env.VITE_KIE_API_KEY
const KIE_ENDPOINT = 'https://api.kie.ai/api/v1/jobs/createTask'

// ─── PARAMÈTRES FIXES — JAMAIS MODIFIABLES ────────────────────────────────────
const FIXED_PARAMS = {
  model: 'nano-banana-2',
  resolution: '1K',
  output_format: 'jpg',
} as const

// ─── TYPES ───────────────────────────────────────────────────────────────────
export type AspectRatio = '9:16' | '16:9'

export interface GenerateMythoParams {
  userPrompt: string
  imageUrl: string
  aspectRatio: AspectRatio
}

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
      // Essai JSON stringifié
      try {
        const parsed = JSON.parse(current)
        queue.push(parsed)
      } catch {
        // ignore JSON parse error
      }

      // Essai string URL-encodée
      try {
        const decoded = decodeURIComponent(current)
        if (decoded !== current) queue.push(decoded)
      } catch {
        // ignore decode errors
      }

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
      if (maybeSingle && /(png|jpg|jpeg|webp|gif|bmp|image|media|cdn|storage)/i.test(maybeSingle)) {
        return maybeSingle
      }
      continue
    }

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item))
      continue
    }

    if (typeof current === 'object') {
      const obj = current as Record<string, unknown>
      if (seen.has(obj)) continue
      seen.add(obj)

      const directKeys = [
        'image_url', 'imageUrl', 'url', 'output_url', 'result_url', 'download_url',
      ]
      for (const key of directKeys) {
        const v = obj[key]
        if (typeof v === 'string') {
          const normalized = normalizeUrl(v)
          if (normalized) return normalized
        }
      }

      // Fallback base64 (certaines réponses Kie n'ont pas d'URL, seulement un b64)
      const base64Keys = ['b64_json', 'base64', 'imageBase64', 'resultBase64']
      for (const key of base64Keys) {
        const v = obj[key]
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
      try {
        const parsed = JSON.parse(current)
        queue.push(parsed)
      } catch {
        // ignore JSON parse errors
      }
      const m = current.match(idRegex)
      if (m?.[1]) return m[1]
      continue
    }

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item))
      continue
    }

    if (typeof current === 'object') {
      const obj = current as Record<string, unknown>
      if (seen.has(obj)) continue
      seen.add(obj)

      const directKeys = [
        'task_id', 'taskId', 'id', 'job_id', 'jobId', 'record_id', 'recordId',
      ]
      for (const key of directKeys) {
        const v = obj[key]
        if (typeof v === 'string' && v.trim()) return v.trim()
      }

      Object.values(obj).forEach((v) => queue.push(v))
    }
  }

  return null
}

// ─── PROMPT ENHANCER — SAUCE SECRÈTE, JAMAIS VISIBLE CÔTÉ CLIENT ─────────────
// Cette fonction est appelée en interne uniquement.
// L'utilisateur ne voit JAMAIS le prompt enrichi.
// Seul le prompt original est stocké en DB.
export function enhancePrompt(userPrompt: string): string {
  return `${userPrompt}.

CRITICAL REALISM REQUIREMENTS:

The result MUST look like a real, unmodified smartphone photo, indistinguishable from a genuine photograph.
Match the exact lighting conditions of the original photo (direction, color temperature, intensity, shadows).
Match the exact image quality, grain, and softness of the original photo (do NOT make added objects sharper or higher resolution than the rest of the image).
Add realistic shadows, contact points, and reflections where the new element touches existing surfaces.
Preserve the original photo's perspective, depth of field, and camera angle.
The added element should appear naturally integrated, with proper occlusion (parts hidden behind existing objects when appropriate).

TEXT AND BRAND ACCURACY (EXTREMELY IMPORTANT — APPLY THESE RULES WITHOUT EXCEPTION):

ALL text, logos, brand names, numbers, and inscriptions in the generated image MUST be perfectly legible, sharp, and 100% accurate.
ALL text, logos, brand names, numbers, and inscriptions MUST be perfectly legible, sharp, and 100% accurate — NO EXCEPTIONS.
Brand logos must match the official brand exactly (correct font, spacing, proportions, colors).
Watch faces, license plates, signs, labels, prices, dates: every character must be readable and grammatically correct.
NO gibberish text, NO blurry letters, NO invented brand names, NO misspelled words.
If text appears in the image, it must be a real, coherent, spell-checked phrase or word.
REPEAT: every single letter and number must be perfectly readable and correctly spelled.

ANTI-AI DETECTION:

Avoid the typical "AI look": no oversaturated colors, no uncanny smoothness, no perfect symmetry on faces, no overly clean edges.
Preserve natural imperfections: skin pores, fabric texture, ambient dust, motion blur if present in original.
Keep the natural smartphone camera feel (slight noise in shadows, natural color science).

Photo style: shot on iPhone, casual snapshot, natural lighting, no professional retouching.`
}

// ─── GÉNÉRATION PRINCIPALE ────────────────────────────────────────────────────
export async function generateMytho(
  { userPrompt, imageUrl, aspectRatio }: GenerateMythoParams,
  onProgress?: (step: string) => void
): Promise<string> {
  // 0) Priorité au backend (plus stable que le client navigateur)
  let shouldFallbackClient = false
  try {
    onProgress?.('Envoi sécurisé...')
    const response = await fetch('/api/generate-mytho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userPrompt, imageUrl, aspectRatio }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      if (payload?.previewDataUrl && typeof payload.previewDataUrl === 'string') {
        onProgress?.('Mytho prêt !')
        return payload.previewDataUrl as string
      }
      if (payload?.imageUrl) {
        onProgress?.('Mytho prêt !')
        return payload.imageUrl as string
      }
      throw new Error('Réponse serveur invalide : image manquante')
    }
    // En local Vite, /api/* peut renvoyer 404 => fallback client.
    if (response.status === 404) {
      shouldFallbackClient = true
    } else {
      throw new Error(
        payload?.message ||
        payload?.error ||
        `Génération serveur indisponible (${response.status})`
      )
    }
  } catch (err) {
    if (!shouldFallbackClient) throw err
  }

  if (!KIE_API_KEY) throw new Error('Clé API Kie.ai manquante')

  // Validation stricte de l'aspect ratio
  if (aspectRatio !== '9:16' && aspectRatio !== '16:9') {
    throw new Error(`Aspect ratio invalide : ${aspectRatio}. Seuls 9:16 et 16:9 sont acceptés.`)
  }

  // Enrichissement du prompt — invisible pour l'utilisateur
  const enhancedPrompt = enhancePrompt(userPrompt)

  // Payload 100% verrouillé — seuls prompt, imageUrl et aspectRatio varient
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

  const { data } = await axios.post(KIE_ENDPOINT, payload, {
    headers: {
      Authorization: `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  })

  const providerCode = Number(data?.code ?? data?.statusCode ?? 200)
  const providerMsg = String(data?.msg || data?.message || data?.error || '').trim()
  if (providerCode !== 200) {
    if (providerCode === 402 || /credits?\s+insufficient|balance.*enough|top up/i.test(providerMsg)) {
      throw new Error('Kie.ai: crédits API insuffisants. Recharge le solde Kie pour relancer la génération.')
    }
    throw new Error(`Kie.ai: ${providerMsg || `erreur provider (${providerCode})`}`)
  }

  const taskId = extractTaskIdFromAny(data)

  if (!taskId) {
    const apiMsg = data?.msg || data?.message || data?.error || 'task_id introuvable'
    throw new Error(`Kie.ai: ${apiMsg}`)
  }

  // ─── POLLING — toutes les 2s, timeout 2 minutes ───────────────────────────
  const maxAttempts = 120 // 120 × 2s = 240s = 4 minutes
  const pollInterval = 2000
  let bestEffortUrl: string | null = null
  let successWithoutUrlCount = 0

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollInterval))

    onProgress?.(`Génération en cours... (${Math.round((attempt / maxAttempts) * 100)}%)`)

    try {
      // Endpoint officiel Kie.ai (Market): /jobs/recordInfo?taskId=...
      let result: any
      try {
        const response = await axios.get(
          `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
          {
            headers: { Authorization: `Bearer ${KIE_API_KEY}` },
            timeout: 30000,
          }
        )
        result = response.data
      } catch (primaryErr) {
        // Fallback legacy endpoint
        const response = await axios.get(
          `https://api.kie.ai/api/v1/jobs/${encodeURIComponent(taskId)}`,
          {
            headers: { Authorization: `Bearer ${KIE_API_KEY}` },
            timeout: 30000,
          }
        )
        result = response.data
      }

      const normalized = result?.data || result
      const status: string = normalized?.state || normalized?.status || normalized?.task_status
      const maybeUrl = keepOnlyGeneratedUrl(extractImageUrlFromAny(normalized), imageUrl)
      if (maybeUrl) bestEffortUrl = maybeUrl

      if (status === 'completed' || status === 'succeeded' || status === 'success' || status === 'done') {
        const generatedImageUrl = keepOnlyGeneratedUrl(extractImageUrlFromAny(normalized), imageUrl)

        if (!generatedImageUrl) {
          successWithoutUrlCount += 1
          // Kie peut marquer success puis publier l'URL quelques secondes après
          if (successWithoutUrlCount < 15) continue
          throw new Error('Image générée introuvable dans la réponse')
        }

        onProgress?.('Mytho prêt !')
        return generatedImageUrl
      }

      if (status === 'failed' || status === 'error' || status === 'fail') {
        throw new Error(`La génération a échoué : ${normalized?.error || normalized?.message || 'raison inconnue'}`)
      }

      // statuts intermédiaires : 'pending', 'processing', 'running' → on continue
    } catch (err) {
      // Ne pas casser la boucle sur une erreur de polling réseau
      if (attempt === maxAttempts - 1) throw err
    }
  }

  if (bestEffortUrl) {
    onProgress?.('Mytho prêt (fallback) !')
    return bestEffortUrl
  }

  throw new Error('Timeout : la génération a dépassé 4 minutes')
}

// ─── UPLOAD VERS SUPABASE STORAGE ────────────────────────────────────────────
export async function uploadToSupabase(file: File, userId: string): Promise<string> {
  const { supabase } = await import('./supabase')
  const bucketName = String(import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'

  const fileExt = file.name.split('.').pop() || 'jpg'
  const fileName = `${userId}/${Date.now()}.${fileExt}`
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Session utilisateur introuvable pour upload serveur.')

  const dataUrl = await fileToDataUrl(file)
  const response = await fetch('/api/upload-mytho', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      bucketName,
      fileName,
      contentType: file.type || 'image/jpeg',
      dataUrl,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || (!payload?.signedUrl && !payload?.publicUrl)) {
    throw new Error(payload?.error || 'Upload serveur échoué')
  }
  return (payload?.signedUrl || payload?.publicUrl) as string
}

/**
 * Rend l'URL finale robuste:
 * - tente de télécharger l'image générée distante
 * - la ré-uploade dans notre bucket Supabase (URL stable)
 * - fallback sur l'URL originale si la récupération distante échoue
 */
export async function persistGeneratedImage(
  generatedUrl: string,
  userId: string
): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(generatedUrl, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const blob = await res.blob()
    const file = new File([blob], `generated-${Date.now()}.jpg`, {
      type: blob.type || 'image/jpeg',
    })
    const stableUrl = await uploadToSupabase(file, userId)
    return stableUrl
  } catch (err) {
    console.warn('persistGeneratedImage fallback to original URL:', err)
    return generatedUrl
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Impossible de lire le fichier'))
    reader.readAsDataURL(file)
  })
}

// Compatibilité avec l'ancien nom
export const generateImage = generateMytho
