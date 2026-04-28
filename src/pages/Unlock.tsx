import { useState } from 'react'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { PRICE_IDS } from '@/lib/stripe'

export default function Unlock() {
  const [selectedPlan, setSelectedPlan] = useState<'weekly' | 'monthly'>('weekly')
  const [isLoading] = useState(false)

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
      badge: 'LE PLUS CHOISI',
      features: [
        '70 images par mois',
        'Qualité 2K',
        'Génération plus rapide',
        'Aucun watermark',
        'Historique complet',
        'Support prioritaire',
      ],
    },
  }

  const PAYMENT_LINKS = {
    monthly: 'https://buy.stripe.com/fZu4gyauk4oy0rg8dVgYU00',
    weekly: 'https://buy.stripe.com/dRm6oGaukcV4c9Y1PxgYU01',
  }

  const handleCheckout = () => {
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
            <h1 className="text-3xl font-black mb-1">Choisis ton offre</h1>
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
              <span className="ml-1.5 text-[10px] opacity-70">-50%</span>
            </button>

            {/* Mensuel + badge au dessus */}
            <div className="flex-1 relative flex flex-col items-center">
              <span
                className="absolute -top-5 px-2 py-0.5 rounded-full text-[9px] font-black whitespace-nowrap"
                style={{ background: '#C6FF3C', color: '#0A0E1A', boxShadow: '0 0 8px rgba(198,255,60,0.6)' }}
              >
                LE PLUS CHOISI
              </span>
              <button
                onClick={() => setSelectedPlan('monthly')}
                className="w-full py-2.5 rounded-full text-sm font-bold transition-all duration-200"
                style={{
                  background: selectedPlan === 'monthly' ? '#C6FF3C' : 'transparent',
                  color: selectedPlan === 'monthly' ? '#0A0E1A' : '#8A8FA0',
                }}
              >
                Mensuel
                <span className="ml-1.5 text-[10px] opacity-70">-50%</span>
              </button>
            </div>
          </motion.div>

          {/* Card unique selon le plan sélectionné */}
          <motion.div
            key={selectedPlan}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl p-6 mb-5 relative"
            style={{
              background: '#141826',
              border: '1.5px solid rgba(198,255,60,0.4)',
              boxShadow: '0 0 30px rgba(198,255,60,0.08)',
            }}
          >
            {selectedPlan === 'monthly' && (
              <div
                className="absolute -top-3 left-5 px-3 py-0.5 rounded-full text-[11px] font-black"
                style={{ background: '#C6FF3C', color: '#0A0E1A' }}
              >
                LE PLUS CHOISI
              </div>
            )}

            {/* Prix */}
            <div className="flex items-baseline gap-2 mb-1">
              {currentPlan.originalPrice && (
                <span className="text-base text-text-secondary line-through">{currentPlan.originalPrice}</span>
              )}
              <span className="text-4xl font-black">{currentPlan.price}</span>
              <span className="text-text-secondary text-sm">{currentPlan.period}</span>
            </div>

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

          {/* Badges */}
          <div className="flex gap-2 mb-5">
            <div className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background: 'rgba(198,255,60,0.06)', border: '1px solid rgba(198,255,60,0.15)', color: '#C6FF3C' }}>
              🛡️ Satisfait ou remboursé
            </div>
            <div className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', color: '#fb923c' }}>
              🔥 -50% aujourd'hui
            </div>
          </div>

          {/* CTA */}
          <Button
            onClick={handleCheckout}
            disabled={isLoading}
            size="lg"
            fullWidth
            className="mb-3"
          >
            {isLoading ? 'Chargement...' : 'DEVENIR MYTHO PRO →'}
          </Button>

          <p className="text-center text-xs text-text-secondary">
            🔒 Paiement sécurisé · Annulable à tout moment
          </p>
        </div>
      </div>
    </div>
  )
}
