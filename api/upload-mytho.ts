import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function getBearerToken(req: VercelRequest) {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : null
}

function sanitizeFileName(name: string) {
  return (name || 'image.jpg').replace(/[^a-zA-Z0-9._/-]/g, '_')
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/)
  if (!match) throw new Error('Format image invalide (dataUrl)')
  return Buffer.from(match[2], 'base64')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: 'Configuration Supabase serveur manquante' })
  }

  const token = getBearerToken(req)
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const authClient = createClient(supabaseUrl, anonKey)
  const adminClient = createClient(supabaseUrl, serviceKey)

  try {
    const { data: authData, error: authErr } = await authClient.auth.getUser(token)
    if (authErr || !authData.user) return res.status(401).json({ error: 'Invalid session' })

    const { bucketName, fileName, contentType, dataUrl } = req.body || {}
    if (!bucketName || !fileName || !dataUrl) {
      return res.status(400).json({ error: 'Paramètres manquants' })
    }

    const safeFileName = sanitizeFileName(fileName)
    const forcedPath = `${authData.user.id}/${Date.now()}-${safeFileName.split('/').pop() || 'image.jpg'}`
    const buffer = dataUrlToBuffer(String(dataUrl))
    const mimeType = String(contentType || 'image/jpeg')

    let upload = await adminClient.storage
      .from(bucketName)
      .upload(forcedPath, buffer, { contentType: mimeType, upsert: false })

    if (upload.error && /bucket.*not found/i.test(upload.error.message || '')) {
      const createBucket = await adminClient.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: '20MB',
      })
      if (createBucket.error) {
        return res.status(500).json({ error: `Bucket introuvable: ${createBucket.error.message}` })
      }
      upload = await adminClient.storage
        .from(bucketName)
        .upload(forcedPath, buffer, { contentType: mimeType, upsert: false })
    }

    if (upload.error) {
      return res.status(500).json({ error: upload.error.message })
    }

    const { data: publicData } = adminClient.storage.from(bucketName).getPublicUrl(forcedPath)
    return res.status(200).json({ publicUrl: publicData.publicUrl })
  } catch (error) {
    console.error('upload-mytho error:', error)
    return res.status(500).json({ error: 'Upload serveur impossible' })
  }
}
