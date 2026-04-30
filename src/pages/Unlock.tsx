import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { captureEvent, EVENT_CHECKOUT_STARTED } from '@/lib/analytics'
import { PRICE_IDS } from '@/lib/stripe'
import { supabase } from '@/lib/supabase'
import { hasPaidGoMythoAccess } from '@/lib/auth-access'
import { getDailyMythoCount } from '@/lib/daily-counter'

const COUNTDOWN_DURATION_MS = 10 * 60 * 1000 // 10 minutes
const COUNTDOWN_STORAGE_KEY = 'gomytho_offer_countdown_started_at'

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function readCountdownStart(): number {
  try {
    const raw = sessionStorage.getItem(COUNTDOWN_STORAGE_KEY)
    if (raw) {
      const v = Number(raw)
      if (Number.isFinite(v) && v > 0) return v
    }
  } catch { /* sessionStorage indispo */ }
  const now = Date.now()
  try { sessionStorage.setItem(COUNTDOWN_STORAGE_KEY, String(now)) } catch { /* ignore */ }
  return now
}

export default function Unlock() {
  const navigate = useNavigate()
  const [selectedPlan, setSelectedPlan] = useState<'weekly' | 'monthly'>('weekly')
  const [isLoading] = useState(false)

  // Compteur affiché « X mythos crées aujourd'hui » — même seed que la landing.
  const dailyCount = useMemo(() => getDailyMythoCount(), [])

  // Countdown 10 min depuis l'arrivée sur la page (persistant au sein de la
  // session, pour éviter que le timer ne reparte à 10:00 à chaque navigation
  // interne — ce qui détruirait l'effet d'urgence).
  const startedAt = useMemo(() => readCountdownStart(), [])
  const [remaining, setRemaining] = useState(() => Math.max(0, COUNTDOWN_DURATION_MS - (Date.now() - startedAt)))
  useEffect(() => {
    const id = setInterval(() => {
      const next = Math.max(0, COUNTDOWN_DURATION_MS - (Date.now() - startedAt))
      setRemaining(next)
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const offerExpired = remaining <= 0

  const plans = {
    weekly: {
      price: '2,99€',
      period: 'par semaine',
      originalPrice: '5,99€',
      priceId: PRICE_IDS.weekly,
      features: [
        '20 images par semaine',
        'Qualité 1K',
        'Aucun watermark',
        'Historique complet',
      ],
    },
    monthly: {
      price: '9,90€',
      period: 'par mois',
      originalPrice: '19,90€',
      priceId: PRICE_IDS.monthly,
      features: [
        '70 images par mois une fois l’abonnement actif',
        'Qualité 2K',
        'Génération plus rapide',
        'Aucun watermark',
        'Historique complet',
        'Support prioritaire',
      ],
    },
  }

  // Payment Links Stripe : dans le Dashboard, après paiement, URL de succès du LIEN,
  // pas seulement du produit — doit être absolue, ex. :
  //   https://<ton-domaine>/paiementreussi?session_id={CHECKOUT_SESSION_ID}
  // Sinon Stripe ne renvoie pas session_id et les utilisateurs repassent par le checkout.
  const PAYMENT_LINKS = {
    monthly: 'https://buy.stripe.com/fZu4gyauk4oy0rg8dVgYU00',
    weekly: 'https://buy.stripe.com/dRm6oGaukcV4c9Y1PxgYU01',
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return
      const { data: profile } = await supabase
        .from('users')
        .select('plan, subscription_status, credits_remaining, stripe_customer_id')
        .eq('id', session.user.id)
        .maybeSingle()
      if (cancelled || !hasPaidGoMythoAccess(profile)) return
      navigate('/dashboard', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const handleCheckout = () => {
    captureEvent(
      EVENT_CHECKOUT_STARTED,
      { plan: selectedPlan, source: 'choixoffre', provider: 'stripe' },
      { send_instantly: true },
    )
    // Sauvegarder le plan et le prompt en localStorage avant le redirect Stripe
    // (sessionStorage est effacé par les redirects externes)
    localStorage.setItem('gomytho_pending_plan', selectedPlan)
    const savedPrompt = sessionStorage.getItem('userPrompt') || ''
    const savedAspectRatio = sessionStorage.getItem('aspectRatio') || '9:16'
    if (savedPrompt) {
      localStorage.setItem('gomytho_pending_prompt', savedPrompt)
      localStorage.setItem('gomytho_pending_ratio', savedAspectRatio)
    }
    window.location.href = PAYMENT_LINKS[selectedPlan]
  }

  const currentPlan = plans[selectedPlan]

  return (
    <div className="min-h-screen bg-primary-bg">
      <Header showLogin={false} />

      <div className="pt-24 pb-16 px-4">
        <div className="max-w-md mx-auto">

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <h1 className="text-3xl font-black mb-1">Ton mytho est prêt 🎁</h1>
            <p className="text-sm text-text-secondary">Annulable à tout moment, sans engagement</p>
          </motion.div>

          {/* Toggle */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="flex items-center p-1 rounded-full mb-6"
            style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.1)' }}
          >
            {/* Hebdo */}
            <button
              onClick={() => setSelectedPlan('weekly')}
              className="flex-1 py-2.5 rounded-full text-sm font-bold transition-all duration-200"
              style={{
                background: selectedPlan === 'weekly' ? '#C6FF3C' : 'transparent',
                color: selectedPlan === 'weekly' ? '#0A0E1A' : '#8A8FA0',
              }}
            >
              Hebdo
            </button>

            <button
              onClick={() => setSelectedPlan('monthly')}
              className="flex-1 py-2.5 rounded-full text-sm font-bold transition-all duration-200"
              style={{
                background: selectedPlan === 'monthly' ? '#C6FF3C' : 'transparent',
                color: selectedPlan === 'monthly' ? '#0A0E1A' : '#8A8FA0',
              }}
            >
              Mensuel
            </button>
          </motion.div>

          {/* Card unique selon le plan sélectionné */}
          <motion.div
            key={selectedPlan}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl p-6 mb-5"
            style={{
              background: '#141826',
              border: '1.5px solid rgba(198,255,60,0.4)',
              boxShadow: '0 0 30px rgba(198,255,60,0.08)',
            }}
          >
            {/* Prix */}
            <div className="flex items-baseline gap-2 mb-1">
              {currentPlan.originalPrice && (
                <span className="text-base text-text-secondary line-through">{currentPlan.originalPrice}</span>
              )}
              <span className="text-4xl font-black">{currentPlan.price}</span>
              <span className="text-text-secondary text-sm">{currentPlan.period}</span>
            </div>

            {/* ─── Bandeau countdown -50% — design néon ─────────────────── */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, delay: 0.1 }}
              className="mt-3 relative overflow-hidden rounded-xl"
              style={{
                background: offerExpired
                  ? 'linear-gradient(135deg, rgba(248,113,113,0.10), rgba(248,113,113,0.04))'
                  : 'linear-gradient(135deg, rgba(198,255,60,0.10), rgba(249,115,22,0.10))',
                border: `1px solid ${offerExpired ? 'rgba(248,113,113,0.45)' : 'rgba(198,255,60,0.45)'}`,
                boxShadow: offerExpired
                  ? '0 0 22px rgba(248,113,113,0.18)'
                  : '0 0 24px rgba(198,255,60,0.18), inset 0 0 18px rgba(249,115,22,0.06)',
              }}
            >
              {/* Halo pulsé (effet néon vivant) */}
              {!offerExpired && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  initial={{ opacity: 0.35 }}
                  animate={{ opacity: [0.25, 0.55, 0.25] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    background:
                      'radial-gradient(80% 100% at 50% 50%, rgba(198,255,60,0.18), transparent 70%)',
                  }}
                />
              )}

              <div className="relative flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <motion.span
                    aria-hidden
                    animate={offerExpired ? {} : { scale: [1, 1.18, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                    className="text-base"
                    style={{
                      filter: offerExpired
                        ? 'none'
                        : 'drop-shadow(0 0 6px rgba(198,255,60,0.8)) drop-shadow(0 0 12px rgba(249,115,22,0.5))',
                    }}
                  >
                    ⚡
                  </motion.span>
                  <div className="leading-tight">
                    <p
                      className="text-[10px] font-black uppercase tracking-[0.18em]"
                      style={{ color: offerExpired ? '#fca5a5' : '#C6FF3C' }}
                    >
                      Offre -50%
                    </p>
                    <p className="text-[10px] text-text-secondary">
                      {offerExpired ? 'Cette promo est terminée' : 'Expire dans'}
                    </p>
                  </div>
                </div>

                {!offerExpired ? (
                  <div
                    className="text-2xl font-black tabular-nums"
                    style={{
                      color: '#fff',
                      textShadow:
                        '0 0 8px rgba(198,255,60,0.85), 0 0 18px rgba(249,115,22,0.55), 0 0 30px rgba(198,255,60,0.35)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {formatRemaining(remaining)}
                  </div>
                ) : (
                  <div
                    className="text-base font-black uppercase tracking-widest"
                    style={{ color: '#fca5a5' }}
                  >
                    Expirée
                  </div>
                )}
              </div>
            </motion.div>

            {/* Séparateur */}
            <div className="my-4" style={{ height: '1px', background: 'rgba(198,255,60,0.1)' }} />

            {/* Features */}
            <ul className="space-y-3">
              {currentPlan.features.map((f, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-black"
                    style={{ background: 'rgba(198,255,60,0.15)', color: '#C6FF3C' }}
                  >✓</span>
                  <span className="text-text-primary">{f}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Garantie satisfait ou remboursé — pleine largeur, plus visible */}
          <div
            className="flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-black mb-5"
            style={{
              background: 'rgba(198,255,60,0.08)',
              border: '1px solid rgba(198,255,60,0.25)',
              color: '#C6FF3C',
              boxShadow: '0 0 18px rgba(198,255,60,0.10)',
            }}
          >
            <span className="text-lg">🛡️</span>
            <span>Satisfait ou remboursé</span>
          </div>

          {/* ─── Compteur social « live » au-dessus du CTA ──────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="relative overflow-hidden rounded-2xl mb-4"
            style={{
              background:
                'linear-gradient(135deg, rgba(198,255,60,0.06) 0%, rgba(198,255,60,0.02) 50%, rgba(198,255,60,0.10) 100%)',
              border: '1px solid rgba(198,255,60,0.22)',
              boxShadow: '0 0 22px rgba(198,255,60,0.10), inset 0 0 24px rgba(198,255,60,0.04)',
            }}
          >
            {/* Halo qui respire en fond */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                background:
                  'radial-gradient(60% 80% at 30% 50%, rgba(198,255,60,0.18), transparent 70%)',
              }}
            />
            <div className="relative flex items-center gap-3 px-4 py-3.5">
              {/* Pastille « live » */}
              <div className="relative flex items-center justify-center w-3 h-3 flex-shrink-0">
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  animate={{ scale: [1, 1.9, 1], opacity: [0.7, 0, 0.7] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                  style={{ background: '#C6FF3C' }}
                />
                <span
                  className="relative w-2 h-2 rounded-full"
                  style={{
                    background: '#C6FF3C',
                    boxShadow: '0 0 8px rgba(198,255,60,0.95), 0 0 14px rgba(198,255,60,0.5)',
                  }}
                />
              </div>

              <div className="flex-1 leading-tight">
                <p
                  className="text-[9px] font-black uppercase tracking-[0.22em] mb-0.5"
                  style={{ color: '#C6FF3C', opacity: 0.85 }}
                >
                  En direct
                </p>
                <p className="text-sm">
                  <span
                    className="text-xl font-black tabular-nums mr-1.5"
                    style={{
                      color: '#fff',
                      textShadow:
                        '0 0 8px rgba(198,255,60,0.8), 0 0 18px rgba(198,255,60,0.45)',
                    }}
                  >
                    {dailyCount.toLocaleString('fr-FR')}
                  </span>
                  <span className="text-text-primary">mythos créés aujourd'hui</span>
                </p>
              </div>
            </div>
          </motion.div>

          {/* CTA */}
          <Button
            onClick={handleCheckout}
            disabled={isLoading}
            size="lg"
            fullWidth
            className="mb-3"
          >
            {isLoading ? 'Chargement...' : 'DÉBLOQUER MON MYTHO →'}
          </Button>

          <p className="text-center text-xs text-text-secondary">
            🔒 Paiement sécurisé Stripe · Annulable en un clic, remboursé si pas satisfait
          </p>
        </div>
      </div>
    </div>
  )
}
