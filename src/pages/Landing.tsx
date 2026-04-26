import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import Button from '@/components/Button'

const examples = [
  {
    id: 1,
    before: '⌚',
    after: '💎',
    title: 'Poignet vide → Rolex dorée',
  },
  {
    id: 2,
    before: '😐',
    after: '🥸',
    title: 'Selfie normal → Moustache géante',
  },
  {
    id: 3,
    before: '🐟',
    after: '🦈',
    title: 'Photo pêche → Poisson absurde',
  },
  {
    id: 4,
    before: '🏠',
    after: '🏎️',
    title: 'Garage vide → Lamborghini',
  },
  {
    id: 5,
    before: '🤳',
    after: '🎤',
    title: 'Photo solo → Avec célébrité',
  },
  {
    id: 6,
    before: '🏡',
    after: '🦕',
    title: 'Salon normal → Dinosaure',
  },
]

const steps = [
  {
    number: '01',
    title: 'Upload ta photo',
    description: 'Ajoute la photo de ton choix, plus elle est nette plus le résultat sera bluffant.',
    icon: '📷',
  },
  {
    number: '02',
    title: 'Décris ton mytho',
    description: 'Décris ton imagination pour transformer ton image en mytho réaliste.',
    icon: '🎭',
  },
  {
    number: '03',
    title: 'L\'IA génère',
    description: 'En 10 secondes, notre IA crée une image ultra-réaliste impossible à distinguer du vrai.',
    icon: '⚡',
  },
  {
    number: '04',
    title: 'Envoie et profite',
    description: 'Partage à tes potes, mate la réaction, garde ton mytho en mémoire.',
    icon: '🚀',
  },
]

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
    answer: 'À tout moment, en 1 clic. Pas de piège, pas d\'engagement.',
  },
]

export default function Landing() {
  const navigate = useNavigate()
  const [currentExample, setCurrentExample] = useState(0)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentExample((prev) => (prev + 1) % examples.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleCTA = () => {
    navigate('/create')
  }

  return (
    <div className="min-h-screen bg-primary-bg">
      <Header />

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block mb-8 px-6 py-2 bg-secondary-bg rounded-full border border-lime/20"
          >
            <p className="text-sm text-text-secondary">
              <span className="inline-block w-2 h-2 bg-lime rounded-full mr-2 animate-pulse" />
              Plus de 24 836 mythos créés cette semaine
            </p>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl md:text-7xl lg:text-8xl font-black leading-tight mb-6"
          >
            Crée des photos
            <br />
            <span className="text-gradient-lime">ultra réalistes</span>
            <br />
            pour piéger tes potes
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl md:text-2xl text-text-secondary mb-8 max-w-3xl mx-auto"
          >
            L'IA qui mytho ta vie en 10 secondes. De la Rolex au poisson-bite, on a couvert.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-6"
          >
            <Button onClick={handleCTA} size="lg" className="text-2xl px-12 py-6">
              Lancer mon mytho
              <span className="text-3xl">→</span>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="inline-flex items-center gap-2 bg-lime/10 px-4 py-2 rounded-full border border-lime/30"
          >
            <span className="px-2 py-0.5 bg-lime text-primary-bg text-xs font-bold rounded">
              NOUVEAU
            </span>
            <span className="text-sm text-text-secondary">
              Mode Snap rouge indétectable
            </span>
          </motion.div>
        </div>
      </section>

      {/* Before/After Carousel */}
      <section className="py-20 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-hide snap-x snap-mandatory">
            {examples.map((example, index) => (
              <motion.div
                key={example.id}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="flex-shrink-0 w-72 snap-center"
              >
                <div className="bg-secondary-bg rounded-3xl p-6 border border-lime/10 hover:border-lime/30 transition-all">
                  <div className="aspect-[9/16] bg-primary-bg rounded-2xl mb-4 flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute top-4 left-4 px-3 py-1 bg-text-secondary/80 text-primary-bg text-xs font-bold rounded">
                      AVANT
                    </div>
                    <div className="text-8xl mb-4">{example.before}</div>
                    <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-lime/20 to-transparent" />
                    <div className="absolute bottom-4 left-4 px-3 py-1 bg-lime text-primary-bg text-xs font-bold rounded glow-lime">
                      APRÈS
                    </div>
                    <div className="absolute bottom-12 text-8xl">{example.after}</div>
                  </div>
                  <p className="text-sm text-text-secondary text-center">{example.title}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 bg-secondary-bg/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-lime rounded-full" />
              <span className="text-lime text-sm font-semibold tracking-wider uppercase">
                Comment ça marche
              </span>
            </div>
            <h2 className="text-4xl md:text-6xl font-black mb-4">
              Prêt en <span className="text-gradient-lime">30 secondes</span>
            </h2>
            <p className="text-xl text-text-secondary">
              4 étapes simples pour mytho n'importe qui.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-secondary-bg rounded-3xl p-6 border border-lime/10 hover:border-lime/30 transition-all relative"
              >
                <div className="text-6xl font-black text-lime/20 absolute top-4 right-4">
                  {step.number}
                </div>
                <div className="w-16 h-16 bg-lime/10 rounded-2xl flex items-center justify-center mb-4 border border-lime/20">
                  <span className="text-3xl">{step.icon}</span>
                </div>
                <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                <p className="text-text-secondary leading-relaxed">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-6xl font-black text-center mb-12"
          >
            Questions ?
          </motion.h2>

          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-secondary-bg rounded-2xl border border-lime/10 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-lime/5 transition-colors"
                >
                  <span className="font-bold text-lg">{faq.question}</span>
                  <motion.span
                    animate={{ rotate: openFaq === index ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="text-2xl text-lime"
                  >
                    ↓
                  </motion.span>
                </button>
                {openFaq === index && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="px-6 pb-4"
                  >
                    <p className="text-text-secondary leading-relaxed">{faq.answer}</p>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-32 px-4 bg-gradient-to-b from-transparent to-secondary-bg/50">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h2
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="text-5xl md:text-7xl lg:text-8xl font-black mb-12"
          >
            Alors, on mytho ?
          </motion.h2>
          <Button onClick={handleCTA} size="lg" className="text-2xl px-12 py-6">
            Commencer maintenant
            <span className="text-3xl">→</span>
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  )
}
