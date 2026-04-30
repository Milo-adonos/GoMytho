import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { captureEvent, EVENT_CHECKOUT_STARTED } from '@/lib/analytics'
import { PRICE_IDS } from '@/lib/stripe'
import { supabase } from '@/lib/supabase'
import { hasPaidGoMythoAccess } from '@/lib/auth-access'
import { getDailyMythoCount } from '@/lib/daily-counter'

export default function Unlock() {
  const navigate = useNavigate()
  const [selectedPlan, setSelectedPlan] = useState<'weekly' | 'monthly'>('weekly')
  const [isLoading] = useState(false)

  // Compteur de la journée — partagé avec la landing pour que la valeur
  // soit cohérente d'une page à l'autre (cf. src/lib/daily-counter.ts).
  const baseDailyCount = useMemo(() => getDailyMythoCount(), [])
  const [liveBumps, setLiveBumps] = useState(0)
  const [justBumped, setJustBumped] = useState(false)

  // « Preuve sociale en direct » : tant que la personne reste sur la
  // page, on bump le compteur de +1 toutes les 5–10 secondes (intervalle
  // aléatoire à chaque fois). L'idée : voir le chiffre grimper donne
  // l'impression que d'autres gens payent en temps réel pendant que
  // l'utilisateur hésite. setTimeout récursif pour pouvoir varier le
  // délai à chaque tick (un setInterval forcerait un délai constant).
  useEffect(() => {
    let timerId: number | null = null
    let flashId: number | null = null
    let cancelled = false

    const schedule = () => {
      if (cancelled) return
      const delay = 5000 + Math.random() * 5000 // 5–10s
      timerId = window.setTimeout(() => {
        setLiveBumps((prev) => prev + 1)
        setJustBumped(true)
        flashId = window.setTimeout(() => setJustBumped(false), 1200)
        schedule() // on enchaîne avec un nouveau délai aléatoire
      }, delay)
    }

    schedule()

    return () => {
      cancelled = true
      if (timerId !== null) window.clearTimeout(timerId)
      if (flashId !== null) window.clearTimeout(flashId)
    }
  }, [])

  const dailyCount = baseDailyCount + liveBumps

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
            {/* ─── Ruban « LE Plus choisi » premium ────────────────────────
                Or pâle dégradé + texte sombre = look billet de loterie /
                ticket VIP, lit comme « premium / best-seller » sans crier.
                Mini-pulse subtil sur le scale (plus élégant qu'un blink). */}
            <motion.div
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              className={`absolute -top-2.5 z-10 ${POPULAR_PLAN === 'weekly' ? 'left-6' : 'right-6'}`}
            >
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[10px] font-black uppercase tracking-[0.18em]"
                style={{
                  background: '#0A0E1A',
                  color: '#C6FF3C',
                  border: '1px solid rgba(198,255,60,0.55)',
                  boxShadow:
                    '0 2px 8px rgba(0,0,0,0.45), 0 0 12px rgba(198,255,60,0.35), 0 0 24px rgba(198,255,60,0.18), inset 0 0 6px rgba(198,255,60,0.10)',
                  textShadow: '0 0 6px rgba(198,255,60,0.55)',
                }}
              >
                <span
                  className="px-[5px] py-px rounded-full text-[9px] tracking-[0.18em]"
                  style={{
                    background: 'rgba(198,255,60,0.14)',
                    color: '#C6FF3C',
                    border: '1px solid rgba(198,255,60,0.4)',
                    boxShadow: 'inset 0 0 4px rgba(198,255,60,0.18)',
                  }}
                >
                  LE
                </span>
                Plus choisi
              </span>
            </motion.div>

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
            {/* ─── Sticker « -50% » incliné dans le coin sup. gauche ──────
                Style « stamp / autocollant » : posé légèrement de travers
                au-dessus du prix barré pour qu'on capte la promo en moins
                d'une seconde. Gradient lime → orange (notre DA) + glow
                doux + ombre portée pour le relief. */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85, rotate: -14 }}
              animate={{ opacity: 1, scale: 1, rotate: -10 }}
              transition={{ duration: 0.4, delay: 0.08, ease: 'easeOut' }}
              className="absolute -top-4 -left-3 z-20"
              style={{ transformOrigin: 'center' }}
            >
              <div
                className="px-3 py-1 rounded-md text-2xl font-black tabular-nums"
                style={{
                  background:
                    'linear-gradient(135deg, #d8ff5e 0%, #C6FF3C 50%, #84cc16 100%)',
                  color: '#0A0E1A',
                  letterSpacing: '0.02em',
                  border: '1.5px solid rgba(255,255,255,0.4)',
                  boxShadow:
                    '0 6px 18px rgba(0,0,0,0.45), 0 0 18px rgba(198,255,60,0.6), 0 0 34px rgba(132,204,22,0.30), inset 0 1px 0 rgba(255,255,255,0.55)',
                  textShadow: '0 1px 1px rgba(255,255,255,0.25)',
                }}
              >
                −50%
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

          {/* Garantie + compteur social : taille bumpée, garantie pleine
              largeur, suivie en dessous d'un mini-compteur dynamique. */}
          <div
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-full text-[13px] font-bold mb-1.5"
            style={{
              background: 'rgba(198,255,60,0.07)',
              border: '1px solid rgba(198,255,60,0.22)',
              color: '#C6FF3C',
            }}
          >
            <span className="text-sm">🛡️</span>
            <span>Satisfait ou remboursé</span>
          </div>

          {/* Bulle compteur live — même style que la garantie pour la
              cohérence visuelle. Animation visible à chaque +1 :
              - bulle qui flashe (background + bordure + halo)
              - léger « pop » (scale)
              - chiffre qui re-monte avec un flash
              - badge « +1 » qui flotte vers le haut au-dessus
              - point lumineux qui pulse en permanence (vibe « live »). */}
          <motion.div
            animate={
              justBumped
                ? {
                    scale: [1, 1.06, 1],
                    backgroundColor: [
                      'rgba(198,255,60,0.07)',
                      'rgba(198,255,60,0.28)',
                      'rgba(198,255,60,0.07)',
                    ],
                    borderColor: [
                      'rgba(198,255,60,0.22)',
                      'rgba(198,255,60,0.85)',
                      'rgba(198,255,60,0.22)',
                    ],
                    boxShadow: [
                      '0 0 0px rgba(198,255,60,0)',
                      '0 0 28px rgba(198,255,60,0.7), 0 0 50px rgba(198,255,60,0.35)',
                      '0 0 0px rgba(198,255,60,0)',
                    ],
                  }
                : { scale: 1 }
            }
            transition={{ duration: 1.1, ease: 'easeOut' }}
            className="relative flex items-center justify-center gap-2 px-4 py-2 rounded-full text-[13px] font-bold mb-3"
            style={{
              background: 'rgba(198,255,60,0.07)',
              border: '1px solid rgba(198,255,60,0.22)',
              color: '#C6FF3C',
            }}
          >
            {/* Badge « +1 » qui flotte vers le haut quand le compteur
                bump. AnimatePresence pour gérer le mount/unmount propre. */}
            <AnimatePresence>
              {justBumped && (
                <motion.div
                  key={`plus1-${liveBumps}`}
                  initial={{ opacity: 0, y: 0, scale: 0.6 }}
                  animate={{ opacity: [0, 1, 1, 0], y: -34, scale: [0.6, 1.15, 1, 1] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.1, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
                  className="absolute left-1/2 -top-1 -translate-x-1/2 pointer-events-none px-2 py-0.5 rounded-full text-[11px] font-black"
                  style={{
                    background: '#C6FF3C',
                    color: '#0A0E1A',
                    boxShadow: '0 0 14px rgba(198,255,60,0.8), 0 4px 10px rgba(0,0,0,0.3)',
                  }}
                >
                  +1
                </motion.div>
              )}
            </AnimatePresence>

            <motion.span
              aria-hidden
              animate={{ opacity: [1, 0.35, 1], scale: [1, 1.25, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="inline-block w-2 h-2 rounded-full"
              style={{
                background: '#C6FF3C',
                boxShadow: '0 0 8px rgba(198,255,60,0.85)',
              }}
            />
            <motion.span
              key={dailyCount}
              initial={{ scale: 0.7, opacity: 0.2, color: '#FFFFFF' }}
              animate={{ scale: 1, opacity: 1, color: '#C6FF3C' }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="font-black tabular-nums"
              style={{ textShadow: '0 0 8px rgba(198,255,60,0.6)' }}
            >
              {dailyCount.toLocaleString('fr-FR')}
            </motion.span>
            <span style={{ color: '#C6FF3C' }}>mythos créés aujourd'hui</span>
          </motion.div>

          {/* CTA — pulse léger pour attirer l'œil sans saturer.
              On anime l'opacité du glow + un mini scale pour que ça respire. */}
          <motion.div
            className="mb-2"
            animate={{
              scale: [1, 1.025, 1],
              filter: [
                'drop-shadow(0 0 0px rgba(198,255,60,0))',
                'drop-shadow(0 0 16px rgba(198,255,60,0.55))',
                'drop-shadow(0 0 0px rgba(198,255,60,0))',
              ],
            }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Button
              onClick={handleCheckout}
              disabled={isLoading}
              size="lg"
              fullWidth
            >
              {isLoading ? 'Chargement...' : 'DÉBLOQUER MON MYTHO →'}
            </Button>
          </motion.div>

          <p className="text-center text-[11px] text-text-secondary leading-snug">
            🔒 Paiement sécurisé Stripe · Annulable en un clic, remboursé si pas satisfait
          </p>
        </div>
      </div>
    </div>
  )
}
