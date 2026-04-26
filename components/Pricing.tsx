'use client'

import { motion } from 'framer-motion'

const plans = [
  {
    name: 'Gratuit',
    price: '0€',
    period: '',
    features: [
      '3 mythos pour tester',
      'Watermark GoMytho',
      'Résolution 1K',
    ],
    cta: 'Commencer gratuitement',
    highlighted: false,
  },
  {
    name: 'Premium',
    price: '4,99€',
    period: '/mois',
    badge: 'Le plus choisi',
    features: [
      'Mythos illimités',
      'Aucun watermark',
      'Résolution 2K',
      'Templates viraux exclusifs',
      'Annulable en 1 clic',
    ],
    cta: 'Devenir Premium',
    highlighted: true,
  },
]

export default function Pricing() {
  return (
    <section className="py-24 px-4 bg-cream">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl md:text-7xl font-black mb-6 tracking-tight">
            Combien ça coûte ?
          </h2>
          <p className="text-xl md:text-2xl text-dark/70">
            Commence gratis. Upgrade si ça part en cacahuète.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2 }}
              whileHover={{ y: -10 }}
              className={`relative bg-white/80 backdrop-blur-sm rounded-3xl p-10 border-2 transition-all duration-300 ${
                plan.highlighted
                  ? 'border-lime shadow-2xl scale-105'
                  : 'border-dark/10 hover:border-dark/20'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-lime text-dark text-sm font-bold px-6 py-2 rounded-full">
                  {plan.badge}
                </div>
              )}

              <div className="text-center mb-8">
                <h3 className="text-3xl font-bold mb-4">{plan.name}</h3>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-6xl font-black">{plan.price}</span>
                  {plan.period && (
                    <span className="text-2xl text-dark/60">{plan.period}</span>
                  )}
                </div>
              </div>

              <ul className="space-y-4 mb-10">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-lime text-xl flex-shrink-0">✓</span>
                    <span className="text-lg text-dark/80">{feature}</span>
                  </li>
                ))}
              </ul>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`w-full py-4 text-lg font-bold rounded-full transition-colors duration-300 ${
                  plan.highlighted
                    ? 'bg-dark text-cream hover:bg-lime hover:text-dark'
                    : 'bg-dark/10 text-dark hover:bg-dark hover:text-cream'
                }`}
              >
                {plan.cta}
              </motion.button>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="text-center mt-12 text-dark/60"
        >
          Pas d'engagement. Pas de bullshit. Juste du mytho.
        </motion.p>
      </div>
    </section>
  )
}
