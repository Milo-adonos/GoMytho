import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { stripePromise, PRICE_IDS } from '@/lib/stripe'

export default function Unlock() {
  const navigate = useNavigate()
  const [selectedPlan, setSelectedPlan] = useState<'weekly' | 'monthly'>('monthly')
  const [isLoading, setIsLoading] = useState(false)

  const plans = {
    weekly: {
      price: '2,99€',
      period: 'par semaine',
      credits: '70 mythos / semaine',
      priceId: PRICE_IDS.weekly,
    },
    monthly: {
      price: '9,90€',
      period: 'par mois',
      originalPrice: '19,90€',
      credits: '610 mythos / mois',
      priceId: PRICE_IDS.monthly,
      badge: 'LE PLUS CHOISI',
    },
  }

  const features = [
    'Mythos illimités sur abonnement',
    'Qualité 2K',
    'Génération ultra rapide',
    'Aucun watermark',
    'Historique complet',
    'Support prioritaire',
  ]

  const handleCheckout = async () => {
    setIsLoading(true)
    try {
      const stripe = await stripePromise
      if (!stripe) {
        throw new Error('Stripe not loaded')
      }

      // Dans un environnement réel, vous appelleriez votre backend ici
      // pour créer une session Stripe Checkout
      // const response = await fetch('/api/create-checkout-session', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     priceId: plans[selectedPlan].priceId,
      //   }),
      // })
      // const session = await response.json()
      // await stripe.redirectToCheckout({ sessionId: session.id })

      // Pour la démo, on redirige directement vers signup
      setTimeout(() => {
        navigate('/signup')
      }, 1000)
    } catch (error) {
      console.error('Error:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary-bg">
      <Header showLogin={false} />

      <div className="pt-32 pb-20 px-4">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-6xl font-black mb-4">
              Ton mytho est prêt
            </h1>
            <p className="text-xl text-text-secondary mb-8">
              Débloque-le maintenant pour voir le rendu complet
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="inline-flex items-center gap-2 bg-lime/10 px-4 py-2 rounded-full border border-lime/30">
                <span className="text-lime">🛡️</span>
                <span className="text-sm font-semibold">Satisfait ou remboursé</span>
              </div>
              <div className="inline-flex items-center gap-2 bg-orange-500/10 px-4 py-2 rounded-full border border-orange-500/30">
                <span className="text-orange-500">🔥</span>
                <span className="text-sm font-semibold text-orange-400">
                  -50% aujourd'hui seulement
                </span>
              </div>
            </div>
          </motion.div>

          {/* Toggle Hebdo / Mensuel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center justify-center gap-4 mb-12"
          >
            <button
              onClick={() => setSelectedPlan('weekly')}
              className={`px-6 py-3 rounded-full font-semibold transition-all ${
                selectedPlan === 'weekly'
                  ? 'bg-lime text-primary-bg'
                  : 'bg-secondary-bg text-text-secondary hover:text-text-primary'
              }`}
            >
              Hebdo
            </button>
            <button
              onClick={() => setSelectedPlan('monthly')}
              className={`px-6 py-3 rounded-full font-semibold transition-all ${
                selectedPlan === 'monthly'
                  ? 'bg-lime text-primary-bg'
                  : 'bg-secondary-bg text-text-secondary hover:text-text-primary'
              }`}
            >
              Mensuel
            </button>
          </motion.div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {/* Card Weekly */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className={`bg-secondary-bg rounded-3xl p-8 border-2 transition-all ${
                selectedPlan === 'weekly'
                  ? 'border-lime scale-105 glow-lime'
                  : 'border-lime/10'
              }`}
            >
              <h3 className="text-2xl font-bold mb-6">Hebdo</h3>
              <div className="mb-6">
                <span className="text-5xl font-black">{plans.weekly.price}</span>
                <span className="text-text-secondary ml-2">{plans.weekly.period}</span>
              </div>
              <p className="text-lime font-semibold mb-8">{plans.weekly.credits}</p>
            </motion.div>

            {/* Card Monthly */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className={`bg-secondary-bg rounded-3xl p-8 border-2 transition-all relative ${
                selectedPlan === 'monthly'
                  ? 'border-lime scale-105 glow-lime'
                  : 'border-lime/10'
              }`}
            >
              {plans.monthly.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-lime text-primary-bg px-4 py-1 rounded-full text-xs font-bold">
                  {plans.monthly.badge}
                </div>
              )}
              <h3 className="text-2xl font-bold mb-6">Mensuel</h3>
              <div className="mb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl text-text-secondary line-through">
                    {plans.monthly.originalPrice}
                  </span>
                  <span className="text-5xl font-black">{plans.monthly.price}</span>
                </div>
                <span className="text-text-secondary">{plans.monthly.period}</span>
              </div>
              <p className="text-lime font-semibold mb-8">{plans.monthly.credits}</p>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-secondary-bg/50 rounded-3xl p-8 mb-8"
          >
            <p className="text-center text-text-secondary mb-6">
              <span className="text-lime font-semibold">⚡ 8 crédits</span> / image
            </p>

            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start gap-3">
                  <span className="text-lime text-xl mt-0.5">✓</span>
                  <span className="text-text-secondary">{feature}</span>
                </div>
              ))}
            </div>

            <Button
              onClick={handleCheckout}
              disabled={isLoading}
              size="lg"
              fullWidth
              className="mb-4"
            >
              {isLoading ? 'Chargement...' : 'DEVENIR MYTHO PRO'}
              <span className="text-2xl">→</span>
            </Button>

            <p className="text-center text-sm text-text-secondary mb-4">
              Annulable à tout moment
            </p>

            <div className="flex items-center justify-center gap-2 text-sm text-orange-400">
              <span>🔥</span>
              <span>1480 personnes ont commencé dans les dernières minutes</span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-center text-xs text-text-secondary/50"
          >
            <p>Paiement sécurisé par Stripe</p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
