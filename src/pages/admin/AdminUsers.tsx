import { useCallback, useEffect, useRef, useState } from 'react'
import LiveBadge from '@/components/LiveBadge'

interface User {
  id: string; email: string; plan: string; subscription_status: string
  created_at: string; total_mythos: number; total_cost_eur: number
  total_revenue_eur: number; net_eur: number
}

interface PanelExclusion {
  email_norm: string
  user_id: string | null
  excluded_at: string
}

const statusColors: Record<string, string> = {
  trialing: '#a3e635',
  active: '#4ade80',
  cancelled: '#f97316',
  inactive: '#8A8FA0',
}
const planColors: Record<string, string> = {
  monthly: '#C6FF3C', weekly: '#8A8FA0',
}

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return "aujourd'hui"
  if (d === 1) return 'il y a 1j'
  if (d < 30) return `il y a ${d}j`
  return `il y a ${Math.floor(d / 30)}m`
}

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<keyof User>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const inFlightRef = useRef(false)
  const [exclusions, setExclusions] = useState<PanelExclusion[]>([])
  const [panelMsg, setPanelMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(null)

  const loadExclusions = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/exclusions', { credentials: 'include' })
      const d = await r.json()
      setExclusions(d.exclusions || [])
    } catch { /* ignore */ }
  }, [])

  const fetchUsers = useCallback(async (force = false) => {
    if (inFlightRef.current && !force) return
    inFlightRef.current = true
    if (users.length === 0) setLoading(true)
    else setRefreshing(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50', search, plan: planFilter, status: statusFilter })
      const r = await fetch(`/api/admin/users?${params}`, { credentials: 'include' })
      const d = await r.json()
      setUsers(d.users || [])
      setTotal(d.total || 0)
      setLastUpdatedAt(Date.now())
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
      setRefreshing(false)
      inFlightRef.current = false
    }
  }, [page, search, planFilter, statusFilter, users.length])

  useEffect(() => { void loadExclusions() }, [loadExclusions])

  useEffect(() => { void fetchUsers() }, [page, planFilter, statusFilter])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchUsers()
    }, 10000)
    return () => clearInterval(id)
  }, [fetchUsers])

  const hideFromPanel = async (u: User) => {
    setPanelMsg(null)
    const r = await fetch('/api/admin/exclusions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: u.email,
        user_id: u.id.startsWith('stripe_') ? null : u.id,
      }),
    })
    let payload: { error?: string; ok?: boolean } = {}
    try {
      payload = await r.json()
    } catch { /* ignore */ }
    if (!r.ok) {
      setPanelMsg({ type: 'err', text: payload.error || `Échec (${r.status}). Vérifie que la table admin_panel_exclusions existe sur Supabase.` })
      return
    }
    setPanelMsg({ type: 'ok', text: 'Compte retiré du panel et des statistiques.' })
    await loadExclusions()
    void fetchUsers(true)
  }

  const restoreToPanel = async (emailNorm: string) => {
    setPanelMsg(null)
    const r = await fetch(`/api/admin/exclusions?email=${encodeURIComponent(emailNorm)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    let payload: { error?: string } = {}
    try {
      payload = await r.json()
    } catch { /* ignore */ }
    if (!r.ok) {
      setPanelMsg({ type: 'err', text: payload.error || `Échec (${r.status})` })
      return
    }
    setPanelMsg({ type: 'ok', text: 'Compte réintégré au panel.' })
    await loadExclusions()
    void fetchUsers(true)
  }

  const handleSort = (key: keyof User) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...users].sort((a, b) => {
    const va = a[sortKey]; const vb = b[sortKey]
    if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va
    return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
  })

  const thCls = "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-text-secondary cursor-pointer hover:text-lime select-none"
  const tdCls = "px-4 py-3 text-sm"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black text-white">Utilisateurs <span className="text-text-secondary font-normal text-base">({total})</span></h1>
        <LiveBadge lastUpdatedAt={lastUpdatedAt} refreshing={refreshing} onRefresh={() => void fetchUsers(true)} />
      </div>

      {panelMsg && (
        <p
          className="text-sm px-3 py-2 rounded-xl border"
          style={{
            borderColor: panelMsg.type === 'err' ? 'rgba(248,113,113,0.4)' : 'rgba(74,222,128,0.35)',
            color: panelMsg.type === 'err' ? '#fca5a5' : '#86efac',
            background: panelMsg.type === 'err' ? 'rgba(248,113,113,0.08)' : 'rgba(74,222,128,0.08)',
          }}
        >
          {panelMsg.text}
        </p>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void fetchUsers(true)}
          placeholder="Rechercher un email..."
          className="px-3 py-2 rounded-xl text-sm bg-secondary-bg text-text-primary border focus:outline-none"
          style={{ borderColor: 'rgba(198,255,60,0.15)', minWidth: '200px' }}
        />
        {(['all', 'weekly', 'monthly'] as const).map(p => (
          <button key={p} onClick={() => { setPlanFilter(p); setPage(1) }}
            className="px-3 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: planFilter === p ? 'rgba(198,255,60,0.15)' : '#141826', color: planFilter === p ? '#C6FF3C' : '#8A8FA0', border: '1px solid rgba(198,255,60,0.1)' }}>
            {p === 'all' ? 'Tous' : p === 'weekly' ? 'Hebdo' : 'Mensuel'}
          </button>
        ))}
        {(['all', 'active', 'cancelled'] as const).map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
            className="px-3 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: statusFilter === s ? 'rgba(198,255,60,0.15)' : '#141826', color: statusFilter === s ? '#C6FF3C' : '#8A8FA0', border: '1px solid rgba(198,255,60,0.1)' }}>
            {s === 'all' ? 'Tous statuts' : s === 'active' ? 'Actif' : 'Annulé'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <tr>
                {[['email', 'Email'], ['plan', 'Plan'], ['subscription_status', 'Statut'], ['created_at', 'Inscription'], ['total_mythos', 'Analyses'], ['total_cost_eur', 'Coût IA'], ['total_revenue_eur', 'CA'], ['net_eur', 'Net']].map(([key, label]) => (
                  <th key={key} className={thCls} onClick={() => handleSort(key as keyof User)}>
                    {label} {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-text-secondary">Panel</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-text-secondary text-sm">Chargement...</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-text-secondary text-sm">Aucun utilisateur ne correspond aux filtres.</td></tr>
              ) : sorted.map((u, i) => (
                <tr key={u.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  className="hover:bg-white/5 transition-colors">
                  <td className={`${tdCls} text-lime font-medium`}>{u.email}</td>
                  <td className={tdCls}>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: `${planColors[u.plan] || '#8A8FA0'}20`, color: planColors[u.plan] || '#8A8FA0' }}>
                      {u.plan === 'weekly' ? 'Hebdo' : 'Mensuel'}
                    </span>
                  </td>
                  <td className={tdCls}>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: `${statusColors[u.subscription_status] || '#8A8FA0'}20`, color: statusColors[u.subscription_status] || '#8A8FA0' }}>
                      {u.subscription_status}
                    </span>
                  </td>
                  <td className={`${tdCls} text-text-secondary`}>{relativeDate(u.created_at)}</td>
                  <td className={`${tdCls} text-text-primary`}>{u.total_mythos}</td>
                  <td className={`${tdCls} text-orange-400`}>{u.total_cost_eur.toFixed(2)}€</td>
                  <td className={`${tdCls} text-white`}>{u.total_revenue_eur.toFixed(2)}€</td>
                  <td className={tdCls} style={{ color: u.net_eur >= 0 ? '#4ade80' : '#ef4444' }}>
                    {u.net_eur >= 0 ? '+' : ''}{u.net_eur.toFixed(2)}€
                  </td>
                  <td className={tdCls}>
                    <button
                      type="button"
                      title="Retire ce compte des listes et des statistiques du panel (ne supprime pas le compte)"
                      onClick={() => void hideFromPanel(u)}
                      className="text-[11px] font-bold px-2 py-1.5 rounded-lg transition-opacity hover:opacity-90 border"
                      style={{ borderColor: 'rgba(248,113,113,0.35)', color: '#fca5a5', background: 'rgba(248,113,113,0.08)' }}
                    >
                      Masquer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <p className="text-xs text-text-secondary">Page {page} · {total} utilisateurs</p>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-30 border" style={{ borderColor: 'rgba(198,255,60,0.2)', color: '#C6FF3C' }}>←</button>
              <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-30 border" style={{ borderColor: 'rgba(198,255,60,0.2)', color: '#C6FF3C' }}>→</button>
            </div>
          </div>
        )}
      </div>

      {exclusions.length > 0 && (
        <div className="rounded-2xl overflow-hidden p-4 space-y-3" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-black text-white">Comptes masqués du panel <span className="text-text-secondary font-normal">({exclusions.length})</span></h2>
          <p className="text-xs text-text-secondary max-w-2xl">
            Ces adresses ne figurent plus dans la liste ni dans les agrégats (vue d’ensemble, analyses, finances, Stripe par email). Les comptes réels et les données ne sont pas supprimés.
          </p>
          <ul className="space-y-2">
            {exclusions.map((ex) => (
              <li key={ex.email_norm} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-lime">{ex.email_norm}</span>
                <button
                  type="button"
                  onClick={() => void restoreToPanel(ex.email_norm)}
                  className="text-[11px] font-bold px-2 py-1.5 rounded-lg border"
                  style={{ borderColor: 'rgba(198,255,60,0.3)', color: '#C6FF3C', background: 'rgba(198,255,60,0.06)' }}
                >
                  Réafficher
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
