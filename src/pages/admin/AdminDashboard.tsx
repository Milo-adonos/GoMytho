import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import LiveBadge from '@/components/LiveBadge'

interface DashboardData {
  totalRevenue: number
  revenue30d: number
  totalCost: number
  totalMythos: number
  netProfit: number
  margin: number
  activeSubscribers: number
  weeklySubscribers: number
  monthlySubscribers: number
  newSubscribers30d: number
  newSubscribersGrowth: number
  churnRate: number
  churnCount: number
  dailyRevenue: { date: string; revenue: number }[]
  dailyMythos: { date: string; mythos: number }[]
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch('/api/admin/dashboard', { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

function MetricCard({ icon, label, value, sub, accent }: {
  icon: string; label: string; value: string; sub: string; accent: string
}) {
  return (
    <div className="rounded-2xl p-5" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xl">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{label}</span>
      </div>
      <p className="text-3xl font-semibold text-white mb-1">{value}</p>
      <p className="text-xs text-text-secondary">{sub}</p>
    </div>
  )
}

export default function AdminDashboard() {
  const { data, loading, refreshing, lastUpdatedAt, refresh } = useAutoRefresh(fetchDashboard, {
    intervalMs: 10000,
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime" />
      </div>
    )
  }
  if (!data) return <p className="text-text-secondary">Erreur de chargement</p>

  const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-black text-white">Vue d'ensemble</h1>
          <p className="text-xs text-text-secondary mt-0.5">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <LiveBadge lastUpdatedAt={lastUpdatedAt} refreshing={refreshing} onRefresh={refresh} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <MetricCard icon="💰" label="CA Total" value={fmt(data.totalRevenue)} sub={`+${fmt(data.revenue30d)} ces 30 jours`} accent="#C6FF3C" />
        <MetricCard icon="📈" label="Bénéfice net" value={fmt(data.netProfit)} sub={`Marge : ${data.margin.toFixed(1)}%`} accent="#4ade80" />
        <MetricCard icon="🤖" label="Coût IA" value={fmt(data.totalCost)} sub={`${data.totalMythos.toLocaleString('fr-FR')} analyses`} accent="#fb923c" />
        <MetricCard icon="👥" label="Abonnés actifs" value={data.activeSubscribers.toString()} sub={`${data.weeklySubscribers} hebdo · ${data.monthlySubscribers} mensuel`} accent="#60a5fa" />
        <MetricCard icon="✨" label="Nouveaux (30j)" value={`+${data.newSubscribers30d}`} sub={`+${data.newSubscribersGrowth.toFixed(1)}% vs mois dernier`} accent="#C6FF3C" />
        <MetricCard
          icon="📉" label="Churn (30j)"
          value={`${data.churnRate.toFixed(1)}%`}
          sub={`${data.churnCount} annulation${data.churnCount > 1 ? 's' : ''} ce mois`}
          accent={data.churnRate > 10 ? '#ef4444' : '#4ade80'}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-5" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-sm font-bold text-white mb-4">Revenus quotidiens (30j)</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.dailyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8A8FA0' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#8A8FA0' }} tickFormatter={v => `${v}€`} />
              <Tooltip contentStyle={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)', borderRadius: '8px', fontSize: '12px' }} formatter={(v) => [`${v}€`, 'Revenus']} />
              <Line type="monotone" dataKey="revenue" stroke="#C6FF3C" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl p-5" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-sm font-bold text-white mb-4">Analyses générées (30j)</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.dailyMythos}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8A8FA0' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#8A8FA0' }} />
              <Tooltip contentStyle={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)', borderRadius: '8px', fontSize: '12px' }} formatter={(v) => [v, 'Analyses']} />
              <Bar dataKey="mythos" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
