import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { captureEvent, EVENT_CHECKOUT_STARTED } from '@/lib/analytics'
import { PRICE_IDS } from '@/lib/stripe'
import { supabase } from '@/lib/supabase'
import { hasPaidGoMythoAccess } from '@/lib/auth-access'

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
      // On garde la valeur uniquement si le compte à rebours n'est pas déjà
      // épuisé. Sinon (visite plus longue qu'une session, retour après une
      // pause, etc.), on relance proprement les 10 min : un client qui
      // tomberait sur « Expirée » dès l'arrivée perdrait totalement le
      // signal d'urgence — pire UX que de remettre 10:00.
      if (Number.isFinite(v) && v > 0 && Date.now() - v < COUNTDOWN_DURATION_MS) {
        return v
      }
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

  // Le toggle a un mini ruban « PLUS CHOISI » au-dessus du plan le plus
  // populaire (Hebdo) pour orienter le choix sans intrusion. C'est le plan
  // d'entrée le plus pris donc on le met en avant.
  const POPULAR_PLAN: 'weekly' | 'monthly' = 'weekly'

  return (
    <div className="min-h-screen bg-primary-bg">
      <Header showLogin={false} />

      <div className="pt-20 pb-8 px-4">
        <div className="max-w-md mx-auto">

          {/* Header — compact pour tenir sur une page */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-5"
          >
            <h1 className="text-2xl sm:text-3xl font-black mb-0.5">Ton mytho est prêt 🎁</h1>
            <p className="text-xs text-text-secondary">Annulable à tout moment, sans engagement</p>
          </motion.div>

          {/* Toggle avec ruban « PLUS CHOISI » au-dessus du plan populaire */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="relative mb-5"
          >
            {/* Ruban flottant — palette « cadeau 🎁 » : rouge boîte + or
                ruban. Lit naturellement avec le titre « Ton mytho est prêt
                🎁 », et reste hyper-lisible sur le bouton Hebdo lime. */}
            <div
              className={`absolute -top-2.5 z-10 ${POPULAR_PLAN === 'weekly' ? 'left-6' : 'right-6'}`}
            >
              <span
                className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[9px] font-black uppercase tracking-[0.16em]"
                style={{
                  background: 'linear-gradient(135deg, #ef4444 0%, #f97316 55%, #fbbf24 100%)',
                  color: '#fff',
                  boxShadow:
                    '0 0 12px rgba(239,68,68,0.6), 0 0 26px rgba(251,191,36,0.35), inset 0 0 8px rgba(255,255,255,0.22)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.35)',
                }}
              >
                <span style={{ filter: 'drop-shadow(0 0 4px rgba(251,191,36,0.85))' }}>🎁</span>
                Plus choisi
              </span>
            </div>

            <div
              className="flex items-center p-1 rounded-full"
              style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.1)' }}
            >
              <button
                onClick={() => setSelectedPlan('weekly')}
                className="flex-1 py-2 rounded-full text-sm font-bold transition-all duration-200"
                style={{
                  background: selectedPlan === 'weekly' ? '#C6FF3C' : 'transparent',
                  color: selectedPlan === 'weekly' ? '#0A0E1A' : '#8A8FA0',
                }}
              >
                Hebdo
              </button>
              <button
                onClick={() => setSelectedPlan('monthly')}
                className="flex-1 py-2 rounded-full text-sm font-bold transition-all duration-200"
                style={{
                  background: selectedPlan === 'monthly' ? '#C6FF3C' : 'transparent',
                  color: selectedPlan === 'monthly' ? '#0A0E1A' : '#8A8FA0',
                }}
              >
                Mensuel
              </button>
            </div>
          </motion.div>

          {/* Card */}
          <motion.div
            key={selectedPlan}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="relative rounded-2xl p-5 mb-3"
            style={{
              background: '#141826',
              border: '1.5px solid rgba(198,255,60,0.4)',
              boxShadow: '0 0 30px rgba(198,255,60,0.08)',
            }}
          >
            {/* ─── Micro-badge -50% + chrono dans le coin sup. GAUCHE ─────── */}
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 }}
              className="absolute -top-2.5 left-4 z-10"
            >
              <div
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-black tracking-wider"
                style={{
                  background: offerExpired
                    ? 'linear-gradient(135deg, rgba(248,113,113,0.18), rgba(20,24,38,1) 60%)'
                    : 'linear-gradient(135deg, rgba(198,255,60,0.20), rgba(20,24,38,1) 60%)',
                  border: `1px solid ${offerExpired ? 'rgba(248,113,113,0.5)' : 'rgba(198,255,60,0.55)'}`,
                  color: offerExpired ? '#fca5a5' : '#C6FF3C',
                  boxShadow: offerExpired
                    ? '0 0 10px rgba(248,113,113,0.25)'
                    : '0 0 10px rgba(198,255,60,0.35), 0 0 22px rgba(198,255,60,0.15)',
                }}
              >
                <span style={{ letterSpacing: '0.04em' }}>−50%</span>
                <span
                  aria-hidden
                  className="w-px h-3"
                  style={{
                    background: offerExpired
                      ? 'rgba(248,113,113,0.4)'
                      : 'rgba(198,255,60,0.45)',
                  }}
                />
                {offerExpired ? (
                  <span className="uppercase">Expirée</span>
                ) : (
                  <span
                    className="tabular-nums"
                    style={{
                      color: '#fff',
                      textShadow: '0 0 6px rgba(198,255,60,0.7)',
                    }}
                  >
                    {formatRemaining(remaining)}
                  </span>
                )}
              </div>
            </motion.div>

            {/* Prix */}
            <div className="flex items-baseline gap-2 mb-1 mt-1">
              {currentPlan.originalPrice && (
                <span className="text-base text-text-secondary line-through">{currentPlan.originalPrice}</span>
              )}
              <span className="text-4xl font-black">{currentPlan.price}</span>
              <span className="text-text-secondary text-sm">{currentPlan.period}</span>
            </div>

            {/* Séparateur */}
            <div className="my-3" style={{ height: '1px', background: 'rgba(198,255,60,0.1)' }} />

            {/* Features — espacement plus serré */}
            <ul className="space-y-2">
              {currentPlan.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black"
                    style={{ background: 'rgba(198,255,60,0.15)', color: '#C6FF3C' }}
                  >✓</span>
                  <span className="text-text-primary">{f}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Garantie : pleine largeur mais petite/discrète */}
          <div
            className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold mb-3"
            style={{
              background: 'rgba(198,255,60,0.06)',
              border: '1px solid rgba(198,255,60,0.2)',
              color: '#C6FF3C',
            }}
          >
            <span className="text-xs">🛡️</span>
            <span>Satisfait ou remboursé</span>
          </div>

          {/* CTA */}
          <Button
            onClick={handleCheckout}
            disabled={isLoading}
            size="lg"
            fullWidth
            className="mb-2"
          >
            {isLoading ? 'Chargement...' : 'DÉBLOQUER MON MYTHO →'}
          </Button>

          <p className="text-center text-[11px] text-text-secondary leading-snug">
            🔒 Paiement sécurisé Stripe · Annulable en un clic, remboursé si pas satisfait
          </p>
        </div>
      </div>
    </div>
  )
}
