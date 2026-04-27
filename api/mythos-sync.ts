import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ─── Manifeste utilisateur dans Supabase Storage ─────────────────────────────
// Permet de synchroniser les créations entre appareils SANS dépendre d'une
// table SQL. Chaque utilisateur a un fichier {bucket}/{uid}/index.json qui
// contient la liste de ses mythos (id, image_path, prompt, created_at).
//
// Endpoints :
//   GET  /api/mythos-sync               → renvoie { entries: [...] } (avec URLs signées fraîches)
//   POST /api/mythos-sync (action=add)  → ajoute une entrée au manifeste
//   POST /api/mythos-sync (action=delete) → supprime une entrée
//   POST /api/mythos-sync (action=replace) → remplace tout le manifeste (migration localStorage)
//
// Authentification : Bearer token Supabase (l'utilisateur ne peut toucher qu'à son propre manifeste).

const MANIFEST_FILE = 'index.json'
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 jours

interface ManifestEntry {
  id: string
  image_path: string // ex: "{uid}/img-1777295180.jpg"
  prompt: string
  created_at: string
}

interface Manifest {
  version: 1
  entries: ManifestEntry[]
}

function getBucket(): string {
  return String(process.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'
}

function getBearerToken(req: VercelRequest): string | null {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : null
}

async function readManifest(adminClient: any, bucket: string, uid: string): Promise<Manifest> {
  const path = `${uid}/${MANIFEST_FILE}`
  try {
    const { data, error } = await adminClient.storage.from(bucket).download(path)
    if (error || !data) return { version: 1, entries: [] }
    const text = await data.text()
    const parsed = JSON.parse(text) as Manifest
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return { version: 1, entries: [] }
    return parsed
  } catch {
    return { version: 1, entries: [] }
  }
}

async function writeManifest(adminClient: any, bucket: string, uid: string, manifest: Manifest): Promise<void> {
  const path = `${uid}/${MANIFEST_FILE}`
  const blob = Buffer.from(JSON.stringify(manifest))
  const { error } = await adminClient.storage.from(bucket).upload(path, blob, {
    contentType: 'application/json',
    upsert: true,
  })
  if (error) {
    if (/bucket.*not found/i.test(error.message || '')) {
      await adminClient.storage.createBucket(bucket, { public: true, fileSizeLimit: '20MB' })
      const retry = await adminClient.storage.from(bucket).upload(path, blob, {
        contentType: 'application/json',
        upsert: true,
      })
      if (retry.error) throw new Error(retry.error.message)
      return
    }
    throw new Error(error.message)
  }
}

async function signUrl(adminClient: any, bucket: string, path: string): Promise<string | null> {
  if (!path) return null
  // Si déjà une URL absolue (legacy), la renvoyer telle quelle
  if (/^https?:\/\//.test(path)) return path
  const { data, error } = await adminClient.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data?.signedUrl) {
    // fallback public URL
    const { data: pub } = adminClient.storage.from(bucket).getPublicUrl(path)
    return pub?.publicUrl || null
  }
  return data.signedUrl
}

// ─── Mirror SQL : insère/supprime aussi dans public.mythos ───────────────────
// Le panel admin agrège ses statistiques depuis cette table. On garde le
// manifeste Storage comme source de vérité côté client, mais on duplique
// les métadonnées en SQL pour les requêtes admin (count, joins users, etc.).
async function mirrorInsertSql(
  adminClient: any,
  bucket: string,
  uid: string,
  entry: ManifestEntry
): Promise<void> {
  try {
    const imageUrl = await signUrl(adminClient, bucket, entry.image_path)
    if (!imageUrl) return
    await adminClient.from('mythos').upsert(
      [{
        id: entry.id,
        user_id: uid,
        image_url: imageUrl,
        prompt: entry.prompt,
        created_at: entry.created_at,
      }],
      { onConflict: 'id' }
    )
  } catch (err) {
    console.warn('[mythos-sync] mirror SQL insert failed (non bloquant):', err)
  }
}

async function mirrorDeleteSql(adminClient: any, id: string): Promise<void> {
  try {
    await adminClient.from('mythos').delete().eq('id', id)
  } catch (err) {
    console.warn('[mythos-sync] mirror SQL delete failed (non bloquant):', err)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  const bucket = getBucket()

  try {
    const { data: authData, error: authErr } = await authClient.auth.getUser(token)
    if (authErr || !authData.user) return res.status(401).json({ error: 'Invalid session' })
    const uid = authData.user.id

    if (req.method === 'GET') {
      const manifest = await readManifest(adminClient, bucket, uid)
      // Régénère des URLs signées fraîches à chaque lecture (jamais d'expiration)
      const enriched = await Promise.all(
        manifest.entries.map(async (entry) => ({
          ...entry,
          image_url: await signUrl(adminClient, bucket, entry.image_path),
        }))
      )
      return res.status(200).json({ entries: enriched })
    }

    if (req.method === 'POST') {
      const { action, entry, id, entries } = req.body || {}
      const manifest = await readManifest(adminClient, bucket, uid)

      if (action === 'add' && entry?.image_path && entry?.prompt) {
        const newEntry: ManifestEntry = {
          id: entry.id || `m-${Date.now()}`,
          image_path: String(entry.image_path),
          prompt: String(entry.prompt),
          created_at: entry.created_at || new Date().toISOString(),
        }
        manifest.entries = [newEntry, ...manifest.entries].slice(0, 500)
        await writeManifest(adminClient, bucket, uid, manifest)
        const image_url = await signUrl(adminClient, bucket, newEntry.image_path)
        // Mirror SQL pour les stats admin (non bloquant)
        await mirrorInsertSql(adminClient, bucket, uid, newEntry)
        return res.status(200).json({ entry: { ...newEntry, image_url } })
      }

      if (action === 'delete' && id) {
        const entryToDelete = manifest.entries.find((e) => e.id === id)
        manifest.entries = manifest.entries.filter((e) => e.id !== id)
        await writeManifest(adminClient, bucket, uid, manifest)
        // Best-effort: supprime aussi le fichier image
        if (entryToDelete?.image_path && !/^https?:\/\//.test(entryToDelete.image_path)) {
          await adminClient.storage.from(bucket).remove([entryToDelete.image_path]).catch(() => {})
        }
        await mirrorDeleteSql(adminClient, id)
        return res.status(200).json({ ok: true })
      }

      if (action === 'replace' && Array.isArray(entries)) {
        const sanitized: ManifestEntry[] = entries
          .filter((e: any) => e && e.image_path && e.prompt)
          .map((e: any) => ({
            id: String(e.id || `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            image_path: String(e.image_path),
            prompt: String(e.prompt),
            created_at: e.created_at || new Date().toISOString(),
          }))
          .slice(0, 500)
        await writeManifest(adminClient, bucket, uid, { version: 1, entries: sanitized })
        return res.status(200).json({ ok: true, count: sanitized.length })
      }

      return res.status(400).json({ error: 'Invalid action or missing fields' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error: any) {
    console.error('mythos-sync error:', error)
    return res.status(500).json({ error: error?.message || 'Server error' })
  }
}
