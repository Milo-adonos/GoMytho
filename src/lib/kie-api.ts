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

  const taskId: string =
    data?.task_id ||
    data?.id ||
    data?.taskId ||
    data?.data?.task_id ||
    data?.data?.id ||
    data?.data?.taskId

  if (!taskId) {
    const apiMsg = data?.message || data?.error || 'task_id introuvable'
    throw new Error(`Kie.ai: ${apiMsg}`)
  }

  // ─── POLLING — toutes les 2s, timeout 2 minutes ───────────────────────────
  const maxAttempts = 60 // 60 × 2s = 120s = 2 minutes
  const pollInterval = 2000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollInterval))

    onProgress?.(`Génération en cours... (${Math.round((attempt / maxAttempts) * 100)}%)`)

    try {
      const { data: result } = await axios.get(
        `https://api.kie.ai/api/v1/jobs/${taskId}`,
        {
          headers: { Authorization: `Bearer ${KIE_API_KEY}` },
          timeout: 30000,
        }
      )

      const normalized = result?.data || result
      const status: string = normalized?.status || normalized?.task_status || normalized?.state

      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        const imageUrl =
          normalized?.output?.image_url ||
          normalized?.output?.[0]?.url ||
          normalized?.result?.url ||
          normalized?.output_url ||
          normalized?.data?.output?.image_url ||
          normalized?.data?.result?.url

        if (!imageUrl) throw new Error('Image générée introuvable dans la réponse')

        onProgress?.('Mytho prêt !')
        return imageUrl
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(`La génération a échoué : ${normalized?.error || normalized?.message || 'raison inconnue'}`)
      }

      // statuts intermédiaires : 'pending', 'processing', 'running' → on continue
    } catch (err) {
      // Ne pas casser la boucle sur une erreur de polling réseau
      if (attempt === maxAttempts - 1) throw err
    }
  }

  throw new Error('Timeout : la génération a dépassé 2 minutes')
}

// ─── UPLOAD VERS SUPABASE STORAGE ────────────────────────────────────────────
export async function uploadToSupabase(file: File, userId: string): Promise<string> {
  const { supabase } = await import('./supabase')
  const bucketName = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos'

  const fileExt = file.name.split('.').pop() || 'jpg'
  const fileName = `${userId}/${Date.now()}.${fileExt}`

  const doUpload = async () => {
    return supabase.storage
      .from(bucketName)
      .upload(fileName, file, { contentType: file.type, upsert: false })
  }

  let { error } = await doUpload()

  // Bucket manquant: essayer de le créer puis retenter une fois
  if (error && /bucket.*not found/i.test(error.message || '')) {
    const { error: createErr } = await supabase.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: '20MB',
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    })

    if (!createErr) {
      const retry = await doUpload()
      error = retry.error
    } else {
      throw new Error(
        `Bucket Supabase introuvable (${bucketName}). Crée un bucket public nommé "${bucketName}" dans Supabase Storage.`
      )
    }
  }

  // Policy RLS ou autres blocages Storage côté client:
  // fallback vers upload serveur (service role) pour éviter le blocage utilisateur.
  if (error && /(row-level security|not allowed|permission|unauthorized|forbidden)/i.test(error.message || '')) {
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
    if (!response.ok || !payload?.publicUrl) {
      throw new Error(payload?.error || 'Upload serveur échoué')
    }
    return payload.publicUrl as string
  }

  if (error) throw error

  const { data: { publicUrl } } = supabase.storage
    .from(bucketName)
    .getPublicUrl(fileName)

  return publicUrl
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
