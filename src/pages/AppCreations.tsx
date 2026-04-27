import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { User } from '@/lib/supabase'
import {
  loadCreations,
  deleteMytho,
  LocalMythoEntry,
  readLocalCreations,
} from '@/lib/mythos-sync'
import GenErrorBanner from '@/components/GenErrorBanner'

export default function AppCreations() {
  const navigate = useNavigate()
  const { user } = useOutletContext<{ user: User | null }>()
  const [mythos, setMythos] = useState<LocalMythoEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LocalMythoEntry | null>(null)
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!user) return
    setLoading(true)
    // 1) Affichage immédiat depuis le cache local (instant, base64 inclus)
    const cached = readLocalCreations(user.id)
    if (cached.length > 0) setMythos(cached)
    // 2) Sync cloud (peut prendre 1-2s) et merge
    void (async () => {
      try {
        const fresh = await loadCreations(user.id)
        setMythos(fresh)
      } catch (err) {
        console.warn('Sync échouée, fallback cache local:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.id])

  const handleDelete = async (id: string) => {
    if (!user) return
    await deleteMytho(user.id, id)
    setMythos((prev) => prev.filter((x) => x.id !== id))
    setSelected(null)
  }

  // ─── Téléchargement bulletproof ────────────────────────────────────────────
  const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const res = await fetch(dataUrl)
    return res.blob()
  }

  const downloadBlob = async (blob: Blob, filename: string) => {
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
    const canShare =
      typeof navigator !== 'undefined' &&
      'canShare' in navigator &&
      (navigator as any).canShare?.({ files: [file] })
    if (canShare && 'share' in navigator) {
      await (navigator as any).share({ files: [file], title: 'GoMytho', text: 'Mon mytho' })
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

  const fetchAsBlob = async (url: string): Promise<Blob | null> => {
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (res.ok) return await res.blob()
    } catch { /* CORS / réseau → fallback proxy */ }
    try {
      const proxyRes = await fetch('/api/image-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      })
      if (!proxyRes.ok) return null
      const payload = await proxyRes.json().catch(() => ({}))
      if (typeof payload?.dataUrl === 'string') {
        return await (await fetch(payload.dataUrl)).blob()
      }
    } catch { /* noop */ }
    return null
  }

  const handleDownload = async (entry: LocalMythoEntry) => {
    const filename = `mytho-${Date.now()}.jpg`
    try {
      // 1) Cache base64 local — toujours fiable
      if (entry.preview_data_url?.startsWith('data:image/')) {
        const blob = await dataUrlToBlob(entry.preview_data_url)
        await downloadBlob(blob, filename)
        return
      }
      // 2) URL absolue (Supabase signed URL)
      if (entry.image_url) {
        const blob = await fetchAsBlob(entry.image_url)
        if (blob) {
          await downloadBlob(blob, filename)
          return
        }
      }
      throw new Error('No accessible image source')
    } catch (error) {
      console.error('download failed', error)
      alert('Téléchargement impossible. Réessaye dans un instant.')
    }
  }

  if (loading && mythos.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime" />
      </div>
    )
  }

  if (mythos.length === 0) {
    return (
      <div className="px-4 py-4">
        <GenErrorBanner />
        <div className="flex flex-col items-center justify-center h-[55vh] px-2 text-center">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 text-4xl"
            style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.15)' }}
          >
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
      </div>
    )
  }

  return (
    <div className="px-3 py-4">
      <div className="px-1">
        <GenErrorBanner />
      </div>
      <div className="flex items-center justify-between mb-4 px-1">
        <h1 className="text-lg font-black">Mes créations</h1>
        <span className="text-xs text-text-secondary">
          {mythos.length} mytho{mythos.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {mythos.map((m, i) => {
          const itemKey = m.id || m.image_url
          const showImg = m.preview_data_url || (m.image_url && !failedImages[itemKey])
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
                {showImg ? (
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
                    handleDownload(m)
                  }}
                  className="mt-2 w-full py-2 rounded-lg text-xs font-black bg-lime text-primary-bg active:scale-95 transition-all"
                >
                  Télécharger
                </button>
              </div>
            </motion.div>
          )
        })}
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
              onClick={(e) => e.stopPropagation()}
            >
              {(selected.preview_data_url ||
                (selected.image_url && !failedImages[selected.id || selected.image_url])) && (
                <img
                  src={selected.preview_data_url || selected.image_url}
                  alt={selected.prompt}
                  className="w-full max-h-72 object-cover"
                  onError={() =>
                    setFailedImages((prev) => ({
                      ...prev,
                      [selected.id || selected.image_url]: true,
                    }))
                  }
                />
              )}
              <div className="p-5">
                <p className="text-xs text-text-secondary uppercase tracking-widest mb-1">Prompt</p>
                <p className="text-sm text-white mb-5">{selected.prompt}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDownload(selected)}
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
