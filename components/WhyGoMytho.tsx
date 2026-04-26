'use client'

import { motion } from 'framer-motion'

const reasons = [
  {
    icon: '⚡',
    title: '10 secondes',
    description: 'Aussi vite que tu Snap. L\'IA génère pendant que tu tapes ton message.',
  },
  {
    icon: '🎨',
    title: 'Aucun talent requis',
    description: 'Pas besoin de Photoshop, de tutos ou de compétences. Tu sais écrire ? C\'est bon.',
  },
  {
    icon: '♾️',
    title: 'Toutes les conneries possibles',
    description: 'L\'IA fait ce que tu lui dis. Vraiment. Du raisonnable au complètement zinzin.',
  },
]

export default function WhyGoMytho() {
  return (
    <section className="py-24 px-4 bg-gradient-to-b from-white/50 to-cream">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl md:text-7xl font-black mb-6 tracking-tight">
            Pourquoi <span className="text-lime">GoMytho</span> ?
          </h2>
          <p className="text-xl md:text-2xl text-dark/70 max-w-3xl mx-auto">
            Parce que mytho tes potes ne devrait pas être compliqué.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
          {reasons.map((reason, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2 }}
              whileHover={{ y: -10 }}
              className="bg-white/80 backdrop-blur-sm rounded-3xl p-10 border-2 border-dark/5 hover:border-lime hover:shadow-xl transition-all duration-300 text-center"
            >
              <div className="text-7xl mb-6">{reason.icon}</div>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">{reason.title}</h3>
              <p className="text-lg text-dark/70 leading-relaxed">{reason.description}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.6 }}
          className="mt-20 bg-dark text-cream rounded-3xl p-12 text-center"
        >
          <p className="text-3xl md:text-4xl font-bold mb-4">
            L'IA qui sert à rien
          </p>
          <p className="text-2xl md:text-3xl text-lime">
            (et c'est ça qui est bien)
          </p>
        </motion.div>
      </div>
    </section>
  )
}
