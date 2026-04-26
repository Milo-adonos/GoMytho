import axios from 'axios'

const KIE_API_KEY = import.meta.env.VITE_KIE_API_KEY
const KIE_API_URL = 'https://api.kie.ai/v1/image-to-image'

if (!KIE_API_KEY) {
  console.warn('Missing Kie.ai API key - image generation will not work')
}

export interface GenerateImageParams {
  imageFile: File
  prompt: string
  model?: string
}

export interface GenerateImageResponse {
  imageUrl: string
  creditsUsed: number
}

export const generateImage = async ({
  imageFile,
  prompt,
  model = 'nano-banana-2',
}: GenerateImageParams): Promise<GenerateImageResponse> => {
  try {
    const formData = new FormData()
    formData.append('image', imageFile)
    formData.append('prompt', prompt)
    formData.append('model', model)

    const response = await axios.post(KIE_API_URL, formData, {
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'multipart/form-data',
      },
    })

    return {
      imageUrl: response.data.image_url,
      creditsUsed: 8, // 8 crédits par image 1K
    }
  } catch (error) {
    console.error('Error generating image:', error)
    throw new Error('Failed to generate image')
  }
}

export const uploadToStorage = async (file: File, userId: string) => {
  const { supabase } = await import('./supabase')
  
  const fileExt = file.name.split('.').pop()
  const fileName = `${userId}/${Date.now()}.${fileExt}`

  const { data, error } = await supabase.storage
    .from('mythos')
    .upload(fileName, file)

  if (error) {
    throw error
  }

  const { data: { publicUrl } } = supabase.storage
    .from('mythos')
    .getPublicUrl(fileName)

  return publicUrl
}
