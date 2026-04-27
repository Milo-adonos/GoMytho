import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import LiveBadge from '@/components/LiveBadge'

interface FinanceData {
  currentMonth: {
    revenue: number; cost: number; margin: number; marginPct: number
    mythos: number; newSubscribers: number; cancellations: number; churnRate: number
  }
  monthlyData: { month: string; revenue: number; cost: number; margin: number }[]
  planSplit: { weekly: number; monthly: number }
  topClients: { rank: number; email: string; plan: string; revenue: number; net: number }[]
}

async function fetchFinance(): Promise<FinanceData> {
  const res = await fetch('/api/admin/finance', { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

export default function AdminFinance() {
  // Mise à jour manuelle uniquement (intervalMs: 0). L'utilisateur clique
  // sur "↻ Rafraîchir" pour récupérer les dernières données Stripe / Supabase.
  const { data, loading, refreshing, lastUpdatedAt, refresh } = useAutoRefresh(fetchFinance, {
    intervalMs: 0,
  })

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime" /></div>
  if (!data) return <p className="text-text-secondary">Erreur de chargement</p>

  const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€'
  const cm = data.currentMonth

  const pieData = [
    { name: 'Hebdo', value: data.planSplit.weekly, color: '#8A8FA0' },
    { name: 'Mensuel', value: data.planSplit.monthly, color: '#C6FF3C' },
  ]

  const tableRows = [
    ['Chiffre d\'affaires', fmt(cm.revenue)],
    ['Coût IA', fmt(cm.cost)],
    ['Marge brute', `${fmt(cm.margin)} (${cm.marginPct.toFixed(1)}%)`],
    ['Analyses générées', cm.mythos.toLocaleString('fr-FR')],
    ['Nouveaux abonnés', `+${cm.newSubscribers}`],
    ['Annulations', cm.cancellations.toString()],
    ['Churn rate', `${cm.churnRate.toFixed(1)}%`],
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black text-white">Finances</h1>
        <LiveBadge lastUpdatedAt={lastUpdatedAt} refreshing={refreshing} onRefresh={refresh} auto={false} />
      </div>

      {/* Récap mois */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-sm font-bold text-white">Mois en cours</p>
        </div>
        <table className="w-full">
          <tbody>
            {tableRows.map(([label, value], i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                <td className="px-5 py-3 text-sm text-text-secondary">{label}</td>
                <td className="px-5 py-3 text-sm font-bold text-white text-right">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-5" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-sm font-bold text-white mb-4">CA vs Coûts (6 mois)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#8A8FA0' }} />
              <YAxis tick={{ fontSize: 11, fill: '#8A8FA0' }} tickFormatter={v => `${v}€`} />
              <Tooltip contentStyle={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)', borderRadius: '8px', fontSize: '12px' }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="revenue" name="CA" fill="#4ade80" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cost" name="Coût IA" fill="#fb923c" radius={[3, 3, 0, 0]} />
              <Bar dataKey="margin" name="Marge" fill="#C6FF3C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl p-5 flex flex-col items-center" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-sm font-bold text-white mb-4 self-start">Répartition CA par plan</p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)', borderRadius: '8px', fontSize: '12px' }} formatter={(v) => [`${v}%`, '']} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs text-text-secondary mt-2">
            {pieData.map(p => (
              <div key={p.name} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                {p.name} ({p.value}%)
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top clients */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-sm font-bold text-white">Top clients par CA</p>
        </div>
        <table className="w-full">
          <thead style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <tr>
              {['#', 'Email', 'Plan', 'CA', 'Net'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-text-secondary">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.topClients.map((c, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                <td className="px-4 py-3 text-sm text-text-secondary font-bold">#{c.rank}</td>
                <td className="px-4 py-3 text-sm text-lime">{c.email}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: 'rgba(198,255,60,0.08)', color: '#C6FF3C' }}>{c.plan}</span></td>
                <td className="px-4 py-3 text-sm text-white font-bold">{c.revenue.toFixed(2)}€</td>
                <td className="px-4 py-3 text-sm font-bold" style={{ color: c.net >= 0 ? '#4ade80' : '#ef4444' }}>+{c.net.toFixed(2)}€</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
