'use client'

import { motion } from 'framer-motion'
import { useState } from 'react'

const useCases = [
  {
    category: 'flex',
    before: '⌚',
    after: '💎',
    title: 'Rolex sur poignet',
    quote: '"Mes parents ont cru que j\'avais investi en crypto"',
    author: 'Mehdi, 19 ans',
    size: 'large',
  },
  {
    category: 'prank',
    before: '🐟',
    after: '🦈',
    title: 'Poisson absurde',
    quote: '"Mon pote a partagé la photo du poisson-bite à toute sa famille"',
    author: 'Sami, 21 ans',
    size: 'medium',
  },
  {
    category: 'prank',
    before: '😐',
    after: '🥸',
    title: 'Moustache géante',
    quote: '"J\'ai mis ça en story, tout le monde a cru que j\'avais pété un câble"',
    author: 'Inès, 18 ans',
    size: 'small',
  },
  {
    category: 'flex',
    before: '🏠',
    after: '🏎️',
    title: 'Lambo au garage',
    quote: '"Mon ex a vraiment cru que j\'avais réussi"',
    author: 'Yacine, 23 ans',
    size: 'medium',
  },
  {
    category: 'prank',
    before: '🏡',
    after: '🦕',
    title: 'Dino dans le salon',
    quote: '"Ma mère a failli appeler les pompiers"',
    author: 'Léa, 17 ans',
    size: 'large',
  },
  {
    category: 'troll',
    before: '🧍',
    after: '👶',
    title: 'Bébé surprise',
    quote: '"Ma copine a vraiment cru que j\'avais un bébé caché"',
    author: 'Kevin, 20 ans',
    size: 'small',
  },
  {
    category: 'troll',
    before: '🤳',
    after: '🎤',
    title: 'Avec Drake',
    quote: '"400 likes en 10 minutes, mes potes sont jaloux"',
    author: 'Sarah, 22 ans',
    size: 'medium',
  },
  {
    category: 'prank',
    before: '💪',
    after: '🦾',
    title: 'Bodybuilder à la salle',
    quote: '"J\'ai envoyé ça à ma coach, elle m\'a demandé quel produit je prenais"',
    author: 'Thomas, 19 ans',
    size: 'small',
  },
]

const UseCaseCard = ({ useCase, index }: { useCase: typeof useCases[0]; index: number }) => {
  const [isHovered, setIsHovered] = useState(false)

  const sizeClasses = {
    small: 'md:col-span-1 md:row-span-1',
    medium: 'md:col-span-2 md:row-span-1',
    large: 'md:col-span-2 md:row-span-2',
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className={`${sizeClasses[useCase.size]} bg-white/50 backdrop-blur-sm rounded-3xl p-8 border-2 border-dark/5 hover:border-lime hover:shadow-2xl transition-all duration-300 cursor-pointer overflow-hidden relative group`}
    >
      <div className="flex flex-col h-full justify-between">
        <div className="flex-1 flex items-center justify-center">
          <div className="relative">
            <motion.div
              animate={{
                scale: isHovered ? 0.8 : 1,
                opacity: isHovered ? 0 : 1,
              }}
              transition={{ duration: 0.3 }}
              className="text-7xl md:text-8xl"
            >
              {useCase.before}
            </motion.div>
            <motion.div
              animate={{
                scale: isHovered ? 1 : 0.8,
                opacity: isHovered ? 1 : 0,
              }}
              transition={{ duration: 0.3 }}
              className="text-7xl md:text-8xl absolute inset-0 flex items-center justify-center"
            >
              {useCase.after}
            </motion.div>
          </div>
        </div>

        <div>
          <h3 className="font-bold text-lg md:text-xl mb-3">{useCase.title}</h3>
          <p className="text-sm text-dark/60 italic mb-1">{useCase.quote}</p>
          <p className="text-xs text-dark/40">— {useCase.author}</p>
        </div>
      </div>

      <div className="absolute top-4 right-4 bg-lime text-dark text-xs font-bold px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
        {isHovered ? 'APRÈS' : 'AVANT'}
      </div>
    </motion.div>
  )
}

export default function UseCases() {
  return (
    <section className="py-24 px-4 bg-gradient-to-b from-cream to-white/50">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-5xl md:text-7xl font-black mb-6 tracking-tight">
            Ça marche pour <span className="text-lime">quoi ?</span>
          </h2>
          <p className="text-xl md:text-2xl text-dark/70 max-w-3xl mx-auto">
            Du flex assumé au prank débile, GoMytho couvre tous tes délires.
            <br />
            <span className="font-semibold text-dark">
              Survole une carte pour voir la magie.
            </span>
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 auto-rows-fr">
          {useCases.map((useCase, index) => (
            <UseCaseCard key={index} useCase={useCase} index={index} />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.8 }}
          className="text-center mt-12 text-lg text-dark/60"
        >
          Et littéralement <span className="font-bold text-dark">tout ce que tu peux imaginer.</span>
        </motion.p>
      </div>
    </section>
  )
}
