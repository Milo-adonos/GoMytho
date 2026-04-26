'use client'

import { motion } from 'framer-motion'

const steps = [
  {
    number: '01',
    title: 'Upload ta photo',
    description: 'Une photo random, peu importe la qualité',
    visual: '📱',
  },
  {
    number: '02',
    title: 'Décris ton délire',
    description: '"Mets-moi une Rolex." "Ajoute un poisson-bite." Voilà.',
    visual: '✍️',
  },
  {
    number: '03',
    title: 'Récupère le mytho',
    description: '10 secondes plus tard, prêt à envoyer dans le groupe WhatsApp',
    visual: '🚀',
  },
]

export default function HowItWorks() {
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
            Comment ça marche ?
          </h2>
          <p className="text-xl md:text-2xl text-dark/70">
            Trois étapes. Zéro prise de tête.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2 }}
              className="relative"
            >
              <div className="text-8xl md:text-9xl font-black text-lime/20 absolute -top-8 -left-4 -z-10">
                {step.number}
              </div>

              <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 border-2 border-dark/5 hover:border-lime hover:shadow-xl transition-all duration-300">
                <div className="text-6xl mb-6">{step.visual}</div>
                <h3 className="text-2xl md:text-3xl font-bold mb-4">{step.title}</h3>
                <p className="text-lg text-dark/70 leading-relaxed">{step.description}</p>
              </div>

              {index < steps.length - 1 && (
                <motion.div
                  animate={{ x: [0, 10, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="hidden md:block absolute top-1/2 -right-6 text-4xl text-lime z-10"
                >
                  →
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.6 }}
          className="text-center mt-16"
        >
          <p className="text-2xl font-bold text-dark">
            Pas de tuto YouTube de 45 minutes.
            <br />
            <span className="text-lime">Juste upload, prompt, mytho.</span>
          </p>
        </motion.div>
      </div>
    </section>
  )
}
