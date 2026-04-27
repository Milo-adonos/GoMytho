import { useEffect, useState } from 'react'

interface Mytho {
  id: string; user_email: string; prompt: string; image_url: string
  aspect_ratio: string; created_at: string; cost: number
}

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'il y a < 1h'
  if (h < 24) return `il y a ${h}h`
  return `il y a ${Math.floor(h / 24)}j`
}

export default function AdminMythos() {
  const [mythos, setMythos] = useState<Mytho[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Mytho | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/mythos?page=${page}&limit=100`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setMythos(d.mythos || []); setTotal(d.total || 0); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page])

  const thCls = "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-text-secondary"
  const tdCls = "px-4 py-3 text-sm"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-white">Analyses <span className="text-text-secondary font-normal text-base">({total})</span></h1>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <tr>
                <th className={thCls}>Aperçu</th>
                <th className={thCls}>Utilisateur</th>
                <th className={thCls}>Prompt</th>
                <th className={thCls}>Format</th>
                <th className={thCls}>Date</th>
                <th className={thCls}>Coût</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-text-secondary text-sm">Chargement...</td></tr>
              ) : mythos.map((m, i) => (
                <tr key={m.id}
                  style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  className="hover:bg-white/5 transition-colors cursor-pointer"
                  onClick={() => setSelected(m)}
                >
                  <td className={tdCls}>
                    {m.image_url ? (
                      <img src={m.image_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg flex items-center justify-center text-xl" style={{ background: 'rgba(198,255,60,0.08)' }}>🎨</div>
                    )}
                  </td>
                  <td className={`${tdCls} text-lime`}>{m.user_email}</td>
                  <td className={`${tdCls} text-text-secondary max-w-xs`}>
                    <span title={m.prompt}>{m.prompt.length > 50 ? m.prompt.slice(0, 50) + '…' : m.prompt}</span>
                  </td>
                  <td className={tdCls}>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: 'rgba(198,255,60,0.08)', color: '#C6FF3C' }}>
                      {m.aspect_ratio || '9:16'}
                    </span>
                  </td>
                  <td className={`${tdCls} text-text-secondary`}>{relativeDate(m.created_at)}</td>
                  <td className={`${tdCls} text-orange-400`}>0,037€</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 100 && (
          <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <p className="text-xs text-text-secondary">Page {page} · {total} analyses</p>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-30 border" style={{ borderColor: 'rgba(198,255,60,0.2)', color: '#C6FF3C' }}>←</button>
              <button disabled={page * 100 >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-30 border" style={{ borderColor: 'rgba(198,255,60,0.2)', color: '#C6FF3C' }}>→</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="rounded-2xl p-5 max-w-md w-full" style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)' }} onClick={e => e.stopPropagation()}>
            {selected.image_url && (
              <img src={selected.image_url} alt="" className="w-full rounded-xl mb-4 object-cover max-h-64" />
            )}
            <p className="text-xs text-text-secondary mb-1 uppercase tracking-widest">Prompt complet</p>
            <p className="text-sm text-white mb-4">{selected.prompt}</p>
            <div className="flex gap-2 text-xs text-text-secondary mb-4">
              <span>👤 {selected.user_email}</span>
              <span>·</span>
              <span>{relativeDate(selected.created_at)}</span>
            </div>
            {selected.image_url && (
              <a href={selected.image_url} download className="block w-full py-2.5 text-center rounded-xl font-bold text-sm bg-lime text-primary-bg">
                Télécharger
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
