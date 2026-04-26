import axios from 'axios'

const KIE_API_KEY = import.meta.env.VITE_KIE_API_KEY
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs/createTask'

export type AspectRatio = '9:16' | '16:9'

// ─── PROMPT ENHANCER ─────────────────────────────────────────────────────────
// Enrichit le prompt court de l'utilisateur en quelque chose d'ultra réaliste
export function enhancePrompt(userPrompt: string): string {
  return `Edit this photo with extreme photorealism: ${userPrompt}.

Requirements:
- The result must look 100% real, like a genuine unedited photograph
- Perfect lighting consistency with the original scene
- Match shadows, reflections and perspective exactly
- Seamlessly blend added elements with the existing environment
- Same camera grain, depth of field and color grading as the original
- No CGI look, no artifacts, no visible compositing
- The image must be indistinguishable from a real photo

Style: hyperrealistic photography, natural lighting, photojournalism quality.`
}

// ─── TYPES ───────────────────────────────────────────────────────────────────
export interface GenerateImageParams {
  imageUrl: string     // URL publique Supabase de la photo uploadée
  prompt: string       // Prompt brut de l'utilisateur
  aspectRatio?: AspectRatio
}

export interface GenerateImageResponse {
  taskId: string
  status: string
}

export interface TaskResult {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  imageUrl?: string
}

// ─── CRÉER UNE TÂCHE DE GÉNÉRATION ───────────────────────────────────────────
export const createGenerationTask = async ({
  imageUrl,
  prompt,
  aspectRatio = '9:16',
}: GenerateImageParams): Promise<GenerateImageResponse> => {
  if (!KIE_API_KEY) throw new Error('Kie.ai API key manquante')

  const enhancedPrompt = enhancePrompt(prompt)

  const payload = {
    model: 'nano-banana-2',          // FIXE — jamais modifié
    input: {
      prompt: enhancedPrompt,
      image_input: [imageUrl],
      aspect_ratio: aspectRatio,
      resolution: '1K',              // FIXE — toujours 1K
      output_format: 'jpg',          // FIXE — toujours jpg
    },
  }

  const response = await axios.post(KIE_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  })

  return {
    taskId: response.data.task_id || response.data.id,
    status: response.data.status,
  }
}

// ─── POLLING DU RÉSULTAT ─────────────────────────────────────────────────────
export const getTaskResult = async (taskId: string): Promise<TaskResult> => {
  if (!KIE_API_KEY) throw new Error('Kie.ai API key manquante')

  const response = await axios.get(
    `https://api.kie.ai/api/v1/jobs/${taskId}`,
    {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    }
  )

  const data = response.data
  const status = data.status

  if (status === 'completed' || status === 'succeeded') {
    return {
      status: 'completed',
      imageUrl: data.output?.image_url || data.output?.[0]?.url || data.result?.url,
    }
  }

  if (status === 'failed' || status === 'error') {
    return { status: 'failed' }
  }

  return { status: 'processing' }
}

// ─── GÉNÉRATION COMPLÈTE AVEC POLLING ────────────────────────────────────────
export const generateImage = async (
  params: GenerateImageParams,
  onProgress?: (step: string) => void
): Promise<string> => {
  onProgress?.('Envoi de ta photo à l\'IA...')
  const { taskId } = await createGenerationTask(params)

  onProgress?.('Génération en cours...')

  // Polling toutes les 3 secondes, max 60 secondes
  const maxAttempts = 20
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const result = await getTaskResult(taskId)

    if (result.status === 'completed' && result.imageUrl) {
      onProgress?.('Mytho prêt !')
      return result.imageUrl
    }

    if (result.status === 'failed') {
      throw new Error('La génération a échoué')
    }

    onProgress?.(`Optimisation du rendu... (${i + 1}/${maxAttempts})`)
  }

  throw new Error('Timeout : la génération a pris trop de temps')
}

// ─── UPLOAD VERS SUPABASE STORAGE ────────────────────────────────────────────
export const uploadToSupabase = async (file: File, userId: string): Promise<string> => {
  const { supabase } = await import('./supabase')

  const fileExt = file.name.split('.').pop() || 'jpg'
  const fileName = `${userId}/${Date.now()}.${fileExt}`

  const { error } = await supabase.storage
    .from('mythos')
    .upload(fileName, file, { contentType: file.type })

  if (error) throw error

  const { data: { publicUrl } } = supabase.storage
    .from('mythos')
    .getPublicUrl(fileName)

  return publicUrl
}
