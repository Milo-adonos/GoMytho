import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, Mytho, User } from '@/lib/supabase'

type LocalMytho = Mytho & {
  preview_data_url?: string
}

export default function AppCreations() {
  const navigate = useNavigate()
  const { user } = useOutletContext<{ user: User | null }>()
  const [mythos, setMythos] = useState<LocalMytho[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LocalMytho | null>(null)
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})

  const normalizeStorageUrl = (url: string) => {
    if (!url) return url
    return url
      .replace('/object/public/mythos%20/', '/object/public/mythos/')
      .replace('/object/public/mythos%2520/', '/object/public/mythos/')
  }

  const isRenderableImageUrl = (url: unknown) => {
    if (typeof url !== 'string') return false
    return url.startsWith('http') || url.startsWith('data:image/')
  }

  const loadLocalMythos = (userId: string) => {
    const key = `gomytho_creations_${userId}`
    const raw = localStorage.getItem(key)
    if (!raw) return [] as LocalMytho[]
    try {
      return JSON.parse(raw) as LocalMytho[]
    } catch {
      return [] as LocalMytho[]
    }
  }

  const saveLocalMythos = (userId: string, list: LocalMytho[]) => {
    const key = `gomytho_creations_${userId}`
    localStorage.setItem(key, JSON.stringify(list))
  }

  const copyUrlToDataUrl = async (url: string): Promise<string | null> => {
    if (!url) return null
    if (url.startsWith('data:image/')) return url
    try {
      const response = await fetch('/api/image-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return null
      return typeof payload?.dataUrl === 'string' ? payload.dataUrl : null
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const localList = loadLocalMythos(user.id)
    const fetchMythos = async () => {
      try {
        const { data } = await supabase.from('mythos').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false })
        const dbList = (data || []) as LocalMytho[]
        const mergedByUrl = new Map<string, LocalMytho>()
        dbList.forEach((m) => mergedByUrl.set(normalizeStorageUrl(m.image_url), { ...m, image_url: normalizeStorageUrl(m.image_url) }))
        localList.forEach((m) => {
          const normalizedUrl = normalizeStorageUrl(m.image_url)
          const existing = mergedByUrl.get(normalizedUrl)
          // Préserver un aperçu local si on l'a
          if (existing) {
            mergedByUrl.set(normalizedUrl, {
              ...existing,
              preview_data_url: existing.preview_data_url || m.preview_data_url,
            })
            return
          }
          mergedByUrl.set(normalizedUrl, { ...m, image_url: normalizedUrl })
        })
        const merged = Array.from(mergedByUrl.values())
          .filter((m) => isRenderableImageUrl(m.preview_data_url || m.image_url))
          .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        setMythos(merged)
        saveLocalMythos(user.id, merged)
        // Backfill: tente de créer un aperçu local persistant pour les entrées sans preview.
        void (async () => {
          const missing = merged.filter((m) => !m.preview_data_url && typeof m.image_url === 'string').slice(0, 6)
          if (missing.length === 0) return
          const updates = await Promise.all(
            missing.map(async (m) => ({
              key: m.id || m.image_url,
              preview: await copyUrlToDataUrl(normalizeStorageUrl(m.image_url)),
            }))
          )
          const hasAtLeastOne = updates.some((u) => !!u.preview)
          if (!hasAtLeastOne) return
          setMythos((prev) => {
            const next = prev.map((item) => {
              const key = item.id || item.image_url
              const found = updates.find((u) => u.key === key)
              if (!found?.preview) return item
              return { ...item, preview_data_url: found.preview }
            })
            saveLocalMythos(user.id, next)
            return next
          })
        })()
        setLoading(false)
      } catch {
        setMythos(localList)
        setLoading(false)
      }
    }
    fetchMythos()
  // Refetch à chaque fois que la page est montée (user.id stable, Date.now() force le refresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const handleDelete = async (id: string) => {
    await supabase.from('mythos').delete().eq('id', id)
    setMythos(m => {
      const next = m.filter(x => x.id !== id)
      if (user?.id) saveLocalMythos(user.id, next)
      return next
    })
    setSelected(null)
  }

  const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const res = await fetch(dataUrl)
    return res.blob()
  }

  const downloadBlob = async (blob: Blob, filename: string) => {
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
    const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator && (navigator as any).canShare?.({ files: [file] })
    if (canShare && 'share' in navigator) {
      await (navigator as any).share({ files: [file], title: 'GoMytho', text: 'Ton mytho est prêt' })
      return
    }
    const objectUrl = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(objectUrl)
  }

  const handleDownload = async (url: string, previewDataUrl?: string) => {
    if (!url) return
    const normalizedUrl = normalizeStorageUrl(url)
    try {
      if (previewDataUrl?.startsWith('data:image/')) {
        const blob = await dataUrlToBlob(previewDataUrl)
        await downloadBlob(blob, `mytho-${Date.now()}.jpg`)
        return
      }
      const response = await fetch(normalizedUrl, { mode: 'cors' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      await downloadBlob(blob, `mytho-${Date.now()}.jpg`)
    } catch (error) {
      console.error('download failed', error)
      if (previewDataUrl?.startsWith('data:image/')) {
        const blob = await dataUrlToBlob(previewDataUrl)
        await downloadBlob(blob, `mytho-${Date.now()}.jpg`)
        return
      }
      alert('Téléchargement impossible : image introuvable (404). Regénère ce mytho.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime" />
      </div>
    )
  }

  if (mythos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] px-6 text-center">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 text-4xl"
          style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.15)' }}>
          🎨
        </div>
        <h2 className="text-xl font-black mb-2">Aucune création</h2>
        <p className="text-text-secondary text-sm mb-6">Lance ton premier mytho et retrouve-le ici</p>
        <button
          onClick={() => navigate('/makemytho')}
          className="px-6 py-3 rounded-full font-black text-primary-bg bg-lime active:scale-95 transition-all"
          style={{ boxShadow: '0 0 30px rgba(198,255,60,0.3)' }}
        >
          Créer mon premier mytho →
        </button>
      </div>
    )
  }

  return (
    <div className="px-3 py-4">
      <div className="flex items-center justify-between mb-4 px-1">
        <h1 className="text-lg font-black">Mes créations</h1>
        <span className="text-xs text-text-secondary">{mythos.length} mytho{mythos.length > 1 ? 's' : ''}</span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-2">
        {mythos.map((m, i) => (
          // Certains enregistrements locaux/anciens peuvent ne pas avoir d'id fiable.
          // On fallback sur image_url pour garder un key stable.
          (() => {
            const itemKey = m.id || m.image_url
            return (
          <motion.div
            key={itemKey}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-2xl overflow-hidden cursor-pointer active:scale-95 transition-all"
            style={{ border: '1px solid rgba(198,255,60,0.1)' }}
            onClick={() => setSelected(m)}
          >
            <div className="aspect-square bg-secondary-bg relative">
              {(m.preview_data_url || m.image_url) && !failedImages[itemKey] ? (
                <img
                  src={m.preview_data_url || m.image_url}
                  alt={m.prompt}
                  className="w-full h-full object-cover"
                  onError={() => setFailedImages((prev) => ({ ...prev, [itemKey]: true }))}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-center px-3">
                  <div className="text-3xl mb-2">🖼️</div>
                  <p className="text-[11px] text-text-secondary">Image indisponible</p>
                </div>
              )}
            </div>
            <div className="px-3 py-2" style={{ background: '#141826' }}>
              <p className="text-xs text-text-secondary truncate">{m.prompt}</p>
              <p className="text-[10px] text-text-secondary/40 mt-0.5">
                {new Date(m.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDownload(normalizeStorageUrl(m.image_url), m.preview_data_url)
                }}
                className="mt-2 w-full py-2 rounded-lg text-xs font-black bg-lime text-primary-bg active:scale-95 transition-all"
              >
                Télécharger
              </button>
            </div>
          </motion.div>
            )
          })()
        ))}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col justify-end"
            style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="rounded-t-3xl overflow-hidden"
              style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.15)' }}
              onClick={e => e.stopPropagation()}
            >
              {(selected.preview_data_url || selected.image_url) && !failedImages[selected.id || selected.image_url] && (
                <img
                  src={selected.preview_data_url || selected.image_url}
                  alt={selected.prompt}
                  className="w-full max-h-72 object-cover"
                  onError={() => setFailedImages((prev) => ({ ...prev, [selected.id || selected.image_url]: true }))}
                />
              )}
              <div className="p-5">
                <p className="text-xs text-text-secondary uppercase tracking-widest mb-1">Prompt</p>
                <p className="text-sm text-white mb-5">{selected.prompt}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDownload(normalizeStorageUrl(selected.image_url), selected.preview_data_url)}
                    className="flex-1 py-3 rounded-xl font-black bg-lime text-primary-bg active:scale-95 transition-all"
                  >
                    ⬇️ Télécharger
                  </button>
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="px-4 py-3 rounded-xl font-bold active:scale-95 transition-all"
                    style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
