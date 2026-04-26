'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'

const examples = [
  {
    before: 'Poignet vide',
    after: 'Rolex dorée',
    emoji: '⌚',
  },
  {
    before: 'Selfie normal',
    after: 'Moustache géante',
    emoji: '🥸',
  },
  {
    before: 'Photo pêche',
    after: 'Poisson absurde',
    emoji: '🐟',
  },
  {
    before: 'Garage vide',
    after: 'Lamborghini',
    emoji: '🏎️',
  },
  {
    before: 'Photo solo',
    after: 'Avec Drake',
    emoji: '🎤',
  },
  {
    before: 'Salon normal',
    after: 'Dinosaure',
    emoji: '🦕',
  },
]

export default function Hero() {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % examples.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleCTA = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-4 py-20 relative overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center max-w-5xl mx-auto"
      >
        <h1 className="text-6xl md:text-8xl lg:text-9xl font-black tracking-tight mb-6 leading-none">
          Mytho ta vie.{' '}
          <span className="text-lime">Littéralement.</span>
        </h1>

        <p className="text-xl md:text-2xl lg:text-3xl text-dark/80 mb-12 max-w-3xl mx-auto leading-relaxed">
          Upload une photo, dis ce que tu veux ajouter, l'IA fait le reste.{' '}
          <span className="text-dark font-semibold">
            De la Rolex au poisson-bite, on a couvert.
          </span>
        </p>

        <div className="mb-16 h-32 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.5 }}
              className="flex items-center gap-8"
            >
              <div className="flex flex-col items-center">
                <div className="text-6xl mb-2 opacity-30">📷</div>
                <p className="text-sm text-dark/60">{examples[currentIndex].before}</p>
              </div>

              <motion.div
                animate={{ x: [0, 10, 0] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="text-4xl"
              >
                →
              </motion.div>

              <div className="flex flex-col items-center">
                <div className="text-6xl mb-2">{examples[currentIndex].emoji}</div>
                <p className="text-sm font-semibold">{examples[currentIndex].after}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <motion.button
          onClick={handleCTA}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-dark text-cream px-8 py-5 text-xl md:text-2xl font-bold rounded-full hover:bg-lime hover:text-dark transition-colors duration-300 inline-flex items-center gap-3 shadow-xl"
        >
          Mytho ma première photo
          <span className="text-2xl">→</span>
        </motion.button>

        <p className="mt-6 text-sm text-dark/50">
          3 mythos gratuits. Aucune CB requise.
        </p>
      </motion.div>

      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-dark/30"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </section>
  )
}
