import { useOutletContext, useNavigate } from 'react-router-dom'
import { supabase, User } from '@/lib/supabase'

const STRIPE_PORTAL_HEBDO = 'https://buy.stripe.com/dRm6oGaukcV4c9Y1PxgYU01'
const STRIPE_PORTAL_MENSUEL = 'https://buy.stripe.com/fZu4gyauk4oy0rg8dVgYU00'
const STRIPE_CANCEL_URL = import.meta.env.VITE_STRIPE_PORTAL_URL || 'https://billing.stripe.com/p/login/eVa3fJ9EQ8L4'

export default function AppSettings() {
  const navigate = useNavigate()
  const { user } = useOutletContext<{ user: User | null }>()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  const planLabel = user?.plan === 'weekly' ? 'Hebdo' : user?.plan === 'monthly' ? 'Mensuel' : 'Gratuit'
  const planColor = user?.subscription_status === 'active' ? '#C6FF3C' : '#8A8FA0'

  const menuItems = [
    {
      icon: '📈',
      label: 'Passer au Mensuel',
      sub: '70 images / mois · 9,90€',
      action: () => window.open(STRIPE_PORTAL_MENSUEL, '_blank'),
      show: user?.plan !== 'monthly',
    },
    {
      icon: '📉',
      label: 'Passer à l\'Hebdo',
      sub: '20 images / semaine · 2,99€',
      action: () => window.open(STRIPE_PORTAL_HEBDO, '_blank'),
      show: user?.plan !== 'weekly',
    },
    {
      icon: '❌',
      label: 'Annuler l\'abonnement',
      sub: 'Gérer via le portail Stripe',
      action: () => window.open(STRIPE_CANCEL_URL, '_blank'),
      show: user?.subscription_status === 'active',
      danger: true,
    },
  ]

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
      {/* Profil */}
      <div className="rounded-2xl p-5" style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.1)' }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-black text-primary-bg"
            style={{ background: '#C6FF3C' }}>
            {user?.email?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white truncate">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black" style={{ background: `${planColor}20`, color: planColor }}>
                {planLabel}
              </span>
              {user?.subscription_status === 'active' && (
                <span className="text-xs text-text-secondary">· Actif</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Crédits */}
      <div className="rounded-2xl p-5" style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.1)' }}>
        <p className="text-xs text-text-secondary uppercase tracking-widest mb-2">Crédits restants</p>
        <div className="flex items-end gap-2">
          <span className="text-4xl font-black text-lime">{user?.credits_remaining ?? 0}</span>
          <span className="text-text-secondary text-sm mb-1">crédits</span>
        </div>
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(198,255,60,0.1)' }}>
          <div className="h-full rounded-full bg-lime transition-all"
            style={{ width: `${Math.min(100, ((user?.credits_remaining ?? 0) / (user?.plan === 'monthly' ? 610 : 140)) * 100)}%` }} />
        </div>
      </div>

      {/* Gestion abonnement */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="px-5 py-3 text-xs font-bold text-text-secondary uppercase tracking-widest border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          Gérer l'abonnement
        </p>
        {menuItems.filter(i => i.show).map((item, idx) => (
          <button
            key={idx}
            onClick={item.action}
            className="w-full flex items-center gap-4 px-5 py-4 text-left transition-all hover:bg-white/5 active:bg-white/10 border-b last:border-b-0"
            style={{ borderColor: 'rgba(255,255,255,0.04)' }}
          >
            <span className="text-xl w-8 flex-shrink-0">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${item.danger ? 'text-red-400' : 'text-white'}`}>{item.label}</p>
              <p className="text-xs text-text-secondary mt-0.5">{item.sub}</p>
            </div>
            <span className="text-text-secondary text-xs">→</span>
          </button>
        ))}
      </div>

      {/* Déconnexion */}
      <button
        onClick={handleLogout}
        className="w-full py-4 rounded-2xl font-bold text-sm active:scale-95 transition-all"
        style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
      >
        🚪 Se déconnecter
      </button>

      <p className="text-center text-xs text-text-secondary pb-4">
        Un problème ? <a href="mailto:support@gomytho.com" className="text-lime underline">support@gomytho.com</a>
      </p>
    </div>
  )
}
