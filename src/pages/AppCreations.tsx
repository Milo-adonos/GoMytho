import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, Mytho, User } from '@/lib/supabase'

export default function AppCreations() {
  const navigate = useNavigate()
  const { user } = useOutletContext<{ user: User | null }>()
  const [mythos, setMythos] = useState<Mytho[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Mytho | null>(null)

  const loadLocalMythos = (userId: string) => {
    const key = `gomytho_creations_${userId}`
    const raw = localStorage.getItem(key)
    if (!raw) return [] as Mytho[]
    try {
      return JSON.parse(raw) as Mytho[]
    } catch {
      return [] as Mytho[]
    }
  }

  const saveLocalMythos = (userId: string, list: Mytho[]) => {
    const key = `gomytho_creations_${userId}`
    localStorage.setItem(key, JSON.stringify(list))
  }

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const localList = loadLocalMythos(user.id)
    const fetchMythos = async () => {
      try {
        const { data } = await supabase.from('mythos').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false })
        const dbList = data || []
        const mergedByUrl = new Map<string, Mytho>()
        dbList.forEach((m: Mytho) => mergedByUrl.set(m.image_url, m))
        localList.forEach((m: Mytho) => {
          if (!mergedByUrl.has(m.image_url)) mergedByUrl.set(m.image_url, m)
        })
        const merged = Array.from(mergedByUrl.values())
          .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        setMythos(merged)
        saveLocalMythos(user.id, merged)
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

  const handleDownload = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `mytho-${Date.now()}.jpg`
    a.click()
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
          <motion.div
            key={m.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-2xl overflow-hidden cursor-pointer active:scale-95 transition-all"
            style={{ border: '1px solid rgba(198,255,60,0.1)' }}
            onClick={() => setSelected(m)}
          >
            <div className="aspect-square bg-secondary-bg relative">
              {m.image_url ? (
                <img src={m.image_url} alt={m.prompt} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl">🎨</div>
              )}
            </div>
            <div className="px-3 py-2" style={{ background: '#141826' }}>
              <p className="text-xs text-text-secondary truncate">{m.prompt}</p>
              <p className="text-[10px] text-text-secondary/40 mt-0.5">
                {new Date(m.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </p>
            </div>
          </motion.div>
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
              {selected.image_url && (
                <img src={selected.image_url} alt={selected.prompt} className="w-full max-h-72 object-cover" />
              )}
              <div className="p-5">
                <p className="text-xs text-text-secondary uppercase tracking-widest mb-1">Prompt</p>
                <p className="text-sm text-white mb-5">{selected.prompt}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDownload(selected.image_url)}
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
