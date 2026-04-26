'use client'

import { motion } from 'framer-motion'

export default function FinalCTA() {
  return (
    <section className="py-32 px-4 bg-dark text-cream overflow-hidden relative">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        className="max-w-5xl mx-auto text-center relative z-10"
      >
        <h2 className="text-6xl md:text-8xl lg:text-9xl font-black mb-12 tracking-tight leading-none">
          Alors, on mytho ?
        </h2>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-lime text-dark px-12 py-6 text-2xl md:text-3xl font-bold rounded-full hover:bg-white transition-colors duration-300 inline-flex items-center gap-4 shadow-2xl"
        >
          Commencer maintenant
          <motion.span
            animate={{ x: [0, 10, 0] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="text-3xl"
          >
            →
          </motion.span>
        </motion.button>

        <p className="mt-8 text-lg text-cream/60">
          3 mythos gratuits. Aucune CB. Aucun regret.
        </p>
      </motion.div>

      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-10 left-10 text-9xl">🎯</div>
        <div className="absolute top-32 right-20 text-8xl">💎</div>
        <div className="absolute bottom-20 left-32 text-7xl">🚀</div>
        <div className="absolute bottom-32 right-16 text-9xl">⚡</div>
      </div>
    </section>
  )
}
