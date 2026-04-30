import { useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { captureEvent, EVENT_STRIPE_CHECKOUT_STARTED } from '@/lib/analytics'
import { supabase, User } from '@/lib/supabase'

const STRIPE_CHECKOUT_HEBDO = 'https://buy.stripe.com/dRm6oGaukcV4c9Y1PxgYU01'
const STRIPE_CHECKOUT_MENSUEL = 'https://buy.stripe.com/fZu4gyauk4oy0rg8dVgYU00'

// URL générique du Customer Portal Stripe (login par email).
// Utilisée en fallback quand on ne peut pas générer une session API
// directe — par exemple si le client a payé avec un email différent
// (Apple Pay, alias…). L'utilisateur entre l'email avec lequel il a payé,
// reçoit un magic-link, et accède à SA page de gestion d'abonnement.
const STRIPE_PORTAL_FALLBACK =
  import.meta.env.VITE_STRIPE_PORTAL_URL ||
  'https://billing.stripe.com/p/login/fZu4gyauk4oy0rg8dVgYU00'

export default function AppSettings() {
  const navigate = useNavigate()
  const { user } = useOutletContext<{ user: User | null }>()
  const [isOpeningPortal, setIsOpeningPortal] = useState(false)

  // Ouvre la page de gestion d'abonnement Stripe.
  //
  // Stratégie en 2 temps :
  //   1) On tente une session de Billing Portal liée au stripe_customer_id
  //      du user (résolu via DB ou recherche email côté serveur). Si OK →
  //      redirect direct sur la page de gestion (zéro saisie).
  //   2) Sinon (cas où le customer Stripe a un email différent, ex Apple
  //      Pay), on bascule silencieusement sur le portail Stripe générique
  //      où l'utilisateur entre l'email avec lequel il a payé.
  //
  // Dans les deux cas, l'utilisateur arrive sur Stripe — on n'affiche
  // jamais "No Stripe customer found" à l'écran.
  const openStripePortal = async () => {
    if (isOpeningPortal) return
    setIsOpeningPortal(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token

      if (token) {
        try {
          const response = await fetch('/api/stripe-portal', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              returnUrl: `${window.location.origin}/settings`,
            }),
          })
          const payload = await response.json().catch(() => ({}))
          if (response.ok && payload?.url) {
            window.location.href = payload.url as string
            return
          }
          console.warn('[stripe-portal] session API indisponible, fallback magic-link:', payload?.error)
        } catch (apiErr) {
          console.warn('[stripe-portal] appel API échoué, fallback magic-link:', apiErr)
        }
      }

      // Fallback : portail Stripe générique (saisie de l'email Stripe).
      window.location.href = STRIPE_PORTAL_FALLBACK
    } catch (err) {
      console.warn('[stripe-portal] erreur fatale, fallback magic-link:', err)
      window.location.href = STRIPE_PORTAL_FALLBACK
    } finally {
      // setIsOpeningPortal(false) inutile : on est déjà parti via redirect.
    }
  }

  // Plan effectif: priorité cache local, sinon DB, sinon inférence basique
  const cachedPlan = localStorage.getItem('gomytho_user_plan') as 'weekly' | 'monthly' | null
  const inferredPlan =
    cachedPlan ||
    (user?.plan as 'weekly' | 'monthly' | undefined) ||
    ((user?.credits_remaining ?? 0) <= 160 ? 'weekly' : 'monthly')

  const handleLogout = async () => {
    try {
      const { resetAnalytics } = await import('@/lib/analytics')
      resetAnalytics()
    } catch { /* ignore */ }
    await supabase.auth.signOut()
    navigate('/')
  }

  const planLabel = inferredPlan === 'weekly' ? 'Hebdo' : inferredPlan === 'monthly' ? 'Mensuel' : 'Gratuit'
  const hasPaidAccess = user?.subscription_status === 'active' || user?.subscription_status === 'trialing'
  const planColor = hasPaidAccess ? '#C6FF3C' : '#8A8FA0'

  const creditDenom =
    user?.subscription_status === 'trialing' && inferredPlan === 'monthly'
      ? 8
      : inferredPlan === 'monthly'
        ? 560
        : 160

  const menuItems = [
    {
      icon: '📈',
      label: 'Passer au Mensuel',
      sub: '70 images / mois · 9,90€',
      action: () => {
        captureEvent(
          EVENT_STRIPE_CHECKOUT_STARTED,
          { plan: 'monthly', source: 'settings' },
          { send_instantly: true },
        )
        localStorage.setItem('gomytho_pending_plan', 'monthly')
        window.location.href = STRIPE_CHECKOUT_MENSUEL
      },
      show: inferredPlan !== 'monthly',
    },
    {
      icon: '📉',
      label: 'Passer à l\'Hebdo',
      sub: '20 images / semaine · 2,99€',
      action: () => {
        captureEvent(
          EVENT_STRIPE_CHECKOUT_STARTED,
          { plan: 'weekly', source: 'settings' },
          { send_instantly: true },
        )
        localStorage.setItem('gomytho_pending_plan', 'weekly')
        window.location.href = STRIPE_CHECKOUT_HEBDO
      },
      show: inferredPlan !== 'weekly',
    },
    {
      icon: '❌',
      label: isOpeningPortal ? 'Ouverture du portail...' : 'Annuler l\'abonnement',
      sub: 'Gérer directement sur Stripe',
      action: openStripePortal,
      show: hasPaidAccess,
      danger: true,
      disabled: isOpeningPortal,
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
              {user?.subscription_status === 'trialing' && (
                <span className="text-xs text-text-secondary">· Essai gratuit</span>
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
            style={{ width: `${Math.min(100, ((user?.credits_remaining ?? 0) / creditDenom) * 100)}%` }} />
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
            disabled={item.disabled}
            className="w-full flex items-center gap-4 px-5 py-4 text-left transition-all hover:bg-white/5 active:bg-white/10 border-b last:border-b-0 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ borderColor: 'rgba(255,255,255,0.04)' }}
          >
            <span className="text-xl w-8 flex-shrink-0">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${item.danger ? 'text-red-400' : 'text-white'}`}>{item.label}</p>
              <p className="text-xs text-text-secondary mt-0.5">{item.sub}</p>
            </div>
            {item.disabled ? (
              <span className="w-4 h-4 rounded-full border-2 border-text-secondary border-t-transparent animate-spin flex-shrink-0" />
            ) : (
              <span className="text-text-secondary text-xs">→</span>
            )}
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
