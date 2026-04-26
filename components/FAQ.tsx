'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'

const faqs = [
  {
    question: 'C\'est légal ?',
    answer: 'Oui. C\'est une blague entre potes, pas une arnaque bancaire. Évite juste de mytho ton banquier.',
  },
  {
    question: 'Mes photos sont stockées ?',
    answer: 'Non. Supprimées dès la génération. On n\'en veut pas.',
  },
  {
    question: 'Ça marche sur quoi ?',
    answer: 'Tout. Vraiment tout. Si tu peux le décrire, l\'IA peut le mettre sur ta photo.',
  },
  {
    question: 'Je peux annuler quand ?',
    answer: 'À tout moment, en 1 clic. Pas de pige, pas d\'engagement.',
  },
]

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="py-24 px-4 bg-gradient-to-b from-white/50 to-cream">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-5xl md:text-7xl font-black mb-6 tracking-tight">
            Questions ?
          </h2>
          <p className="text-xl md:text-2xl text-dark/70">
            On a les réponses.
          </p>
        </motion.div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl border-2 border-dark/5 overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full px-8 py-6 flex items-center justify-between text-left hover:bg-dark/5 transition-colors"
              >
                <span className="text-xl font-bold pr-8">{faq.question}</span>
                <motion.span
                  animate={{ rotate: openIndex === index ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-2xl flex-shrink-0"
                >
                  ↓
                </motion.span>
              </button>

              <AnimatePresence>
                {openIndex === index && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="px-8 pb-6 text-lg text-dark/70 leading-relaxed">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
