import { supabase } from './supabase'

// ─── Synchronisation cloud des créations (multi-appareils) ───────────────────
//
// Les mythos sont stockés dans Supabase Storage:
//   - L'image: {bucket}/{uid}/img-{timestamp}-{rand}.jpg
//   - Le manifeste: {bucket}/{uid}/index.json
//
// Le manifeste est la source de vérité côté serveur. Le localStorage sert de
// cache local rapide (preview base64 inclus pour affichage instantané hors-ligne).

export interface CloudMythoEntry {
  id: string
  image_path: string
  image_url?: string | null
  prompt: string
  created_at: string
}

export interface LocalMythoEntry {
  id: string
  user_id: string
  image_url: string         // URL HTTPS (Supabase) ou data URL fallback
  preview_data_url?: string // base64 cache local (toujours dispo offline)
  prompt: string
  created_at: string
  image_path?: string       // path Supabase pour re-générer l'URL signée
}

const SAFE_FETCH_TIMEOUT = 25000

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Session utilisateur introuvable')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = SAFE_FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function localKey(userId: string): string {
  return `gomytho_creations_${userId}`
}

export function readLocalCreations(userId: string): LocalMythoEntry[] {
  try {
    const raw = localStorage.getItem(localKey(userId))
    if (!raw) return []
    const arr = JSON.parse(raw) as LocalMythoEntry[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// Limite stricte pour éviter le QuotaExceededError : un dataURL base64 fait
// 1 à 3 MB ; le quota localStorage est ~5-10 MB. On stocke donc le preview
// base64 UNIQUEMENT pour les entrées qui n'ont pas encore d'URL cloud
// (upload échoué) — pour le reste, on garde juste les métadonnées.
const MAX_LOCAL_ENTRIES = 60
const MAX_PREVIEW_BYTES = 3_000_000 // ~3 MB de base64 max retenu localement

function isRemoteUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

function compactEntry(entry: LocalMythoEntry): LocalMythoEntry {
  // Si on a déjà une URL cloud, on n'a PAS besoin du base64 — la cloud sera
  // re-fetchée à l'affichage. Économie majeure de localStorage.
  if (isRemoteUrl(entry.image_url) && entry.preview_data_url) {
    const { preview_data_url, ...rest } = entry
    void preview_data_url
    return rest
  }
  // image_url EST une dataURL base64 (upload cloud KO) → on la conserve mais
  // on supprime le preview_data_url qui serait redondant.
  if (entry.image_url?.startsWith('data:') && entry.preview_data_url) {
    const { preview_data_url, ...rest } = entry
    void preview_data_url
    return rest
  }
  // Cas extrêmes : on plafonne les champs base64 si trop gros.
  if (entry.preview_data_url && entry.preview_data_url.length > MAX_PREVIEW_BYTES) {
    return { ...entry, preview_data_url: undefined }
  }
  return entry
}

export function writeLocalCreations(userId: string, list: LocalMythoEntry[]): void {
  const compacted = list.slice(0, MAX_LOCAL_ENTRIES).map(compactEntry)
  const key = localKey(userId)
  const tryWrite = (entries: LocalMythoEntry[]) => {
    localStorage.setItem(key, JSON.stringify(entries))
  }
  try {
    tryWrite(compacted)
  } catch (err) {
    // QuotaExceededError → on retire les preview_data_url un par un puis on
    // tronque la liste jusqu'à ce que ça passe. Jamais bloquer l'app.
    console.warn('[mythos-sync] localStorage quota dépassé, compaction agressive', err)
    let trimmed = compacted.map((e) => {
      if (e.preview_data_url) {
        const { preview_data_url, ...rest } = e
        void preview_data_url
        return rest
      }
      return e
    })
    while (trimmed.length > 0) {
      try {
        tryWrite(trimmed)
        return
      } catch {
        trimmed = trimmed.slice(0, Math.max(0, trimmed.length - 5))
      }
    }
    // Dernier recours : on supprime carrément la clé pour libérer le quota.
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }
}

// ─── Upload d'une dataURL en tant qu'image stockée ──────────────────────────
// Renvoie { url, path } : url = signedUrl (long-lived), path = chemin manifest.
async function uploadDataUrlAsImage(
  dataUrl: string,
  userId: string,
  filename = `mytho-${Date.now()}.jpg`
): Promise<{ url: string; path: string }> {
  const bucketName =
    String(import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'
  const fileName = `${userId}/${Date.now()}-${filename}`
  const headers = await getAuthHeaders()
  const response = await fetchWithTimeout('/api/upload-mytho', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bucketName,
      fileName,
      contentType: 'image/jpeg',
      dataUrl,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || (!payload?.signedUrl && !payload?.publicUrl)) {
    throw new Error(payload?.error || 'Upload serveur échoué')
  }
  return {
    url: (payload.signedUrl || payload.publicUrl) as string,
    path: (payload.path as string) || '',
  }
}

// ─── Sauvegarde une nouvelle création dans le cloud + cache local ───────────
export async function saveMythoToCloud(params: {
  userId: string
  generatedDataUrl: string  // base64 retourné par generateMytho
  prompt: string
}): Promise<LocalMythoEntry> {
  const { userId, generatedDataUrl, prompt } = params

  // 1) Upload l'image générée vers Supabase (URL stable)
  let image_path = ''
  let image_url: string = generatedDataUrl
  try {
    const uploaded = await uploadDataUrlAsImage(generatedDataUrl, userId)
    image_url = uploaded.url
    image_path = uploaded.path
  } catch (err) {
    console.warn('Upload image générée échoué, on continue avec data URL local:', err)
  }

  const localEntry: LocalMythoEntry = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    image_url,
    image_path: image_path || undefined,
    preview_data_url: generatedDataUrl,
    prompt,
    created_at: new Date().toISOString(),
  }

  // 2) Cache localStorage (toujours, pour affichage immédiat)
  const list = readLocalCreations(userId)
  writeLocalCreations(userId, [localEntry, ...list])

  // 3) Synchro cloud (non bloquante mais on attend pour être sûr que ça part)
  if (image_path) {
    try {
      const headers = await getAuthHeaders()
      await fetchWithTimeout('/api/mythos-sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'add',
          entry: {
            id: localEntry.id,
            image_path,
            prompt,
            created_at: localEntry.created_at,
          },
        }),
      })
    } catch (err) {
      console.warn('Synchro cloud échouée (fallback local conservé):', err)
    }
  }

  return localEntry
}

// ─── Charge les créations cloud + merge local cache ─────────────────────────
export async function loadCreations(userId: string): Promise<LocalMythoEntry[]> {
  const localList = readLocalCreations(userId)

  let cloudEntries: CloudMythoEntry[] = []
  try {
    const headers = await getAuthHeaders()
    const res = await fetchWithTimeout('/api/mythos-sync', { method: 'GET', headers })
    if (res.ok) {
      const payload = await res.json().catch(() => ({}))
      if (Array.isArray(payload?.entries)) cloudEntries = payload.entries as CloudMythoEntry[]
    }
  } catch (err) {
    console.warn('Lecture cloud échouée, fallback local:', err)
    return localList
  }

  // Merge: cloud = source de vérité (URL fraîche), local = preview base64 + items pas encore sync
  const cloudIds = new Set(cloudEntries.map((c) => c.id))
  const merged: LocalMythoEntry[] = cloudEntries.map((c) => {
    const localMatch = localList.find((l) => l.id === c.id)
    return {
      id: c.id,
      user_id: userId,
      image_url: c.image_url || localMatch?.image_url || '',
      image_path: c.image_path,
      preview_data_url: localMatch?.preview_data_url,
      prompt: c.prompt,
      created_at: c.created_at,
    }
  })

  // Ajouter les locaux non encore syncés (sans image_path → upload n'a pas eu lieu)
  const localOnly = localList.filter((l) => !cloudIds.has(l.id))
  for (const l of localOnly) {
    merged.push(l)
    // Tente une migration si on a un image_path
    if (l.image_path) {
      try {
        const headers = await getAuthHeaders()
        await fetchWithTimeout('/api/mythos-sync', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'add',
            entry: {
              id: l.id,
              image_path: l.image_path,
              prompt: l.prompt,
              created_at: l.created_at,
            },
          }),
        })
      } catch { /* silent */ }
    }
  }

  merged.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))

  // Persiste le merge dans le cache local
  writeLocalCreations(userId, merged)
  return merged
}

export async function deleteMytho(userId: string, id: string): Promise<void> {
  // Supprime côté cloud
  try {
    const headers = await getAuthHeaders()
    await fetchWithTimeout('/api/mythos-sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'delete', id }),
    })
  } catch (err) {
    console.warn('Delete cloud échoué:', err)
  }
  // Supprime côté local
  const list = readLocalCreations(userId)
  writeLocalCreations(userId, list.filter((l) => l.id !== id))
}
