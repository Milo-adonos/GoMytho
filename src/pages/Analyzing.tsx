import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoadingAnimation from '@/components/LoadingAnimation'
import Button from '@/components/Button'
import { motion, AnimatePresence } from 'framer-motion'

const loadingSteps = [
  'Analyse de ta photo...',
  'Détection des contours et profondeur...',
  'Compréhension du contexte...',
  'Génération du mytho...',
  'Optimisation finale...',
  'Application du rendu réaliste...',
]

export default function Analyzing() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    // Vérifier si on a bien une image uploadée
    const uploadedImage = sessionStorage.getItem('uploadedImage')
    if (!uploadedImage) {
      navigate('/create')
      return
    }

    // Simuler le chargement progressif (15 secondes au total)
    const totalDuration = 15000
    const stepDuration = totalDuration / loadingSteps.length
    
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < loadingSteps.length - 1) {
          return prev + 1
        }
        return prev
      })
    }, stepDuration)

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 100) {
          return prev + (100 / (totalDuration / 100))
        }
        return 100
      })
    }, 100)

    const completeTimeout = setTimeout(() => {
      setIsComplete(true)
    }, totalDuration)

    return () => {
      clearInterval(stepInterval)
      clearInterval(progressInterval)
      clearTimeout(completeTimeout)
    }
  }, [navigate])

  const handleUnlock = () => {
    navigate('/unlock')
  }

  if (!isComplete) {
    return (
      <LoadingAnimation
        text={loadingSteps[currentStep]}
        progress={progress}
      />
    )
  }

  return (
    <div className="min-h-screen bg-primary-bg flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-2xl"
      >
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="w-32 h-32 bg-lime/20 rounded-full flex items-center justify-center mx-auto border-4 border-lime glow-lime">
            <span className="text-7xl">✨</span>
          </div>
        </motion.div>

        <h1 className="text-5xl md:text-6xl font-black mb-6">
          Ton mytho est prêt !
        </h1>

        <p className="text-xl text-text-secondary mb-12">
          Débloque-le maintenant pour voir le rendu complet
        </p>

        <Button onClick={handleUnlock} size="lg" className="text-2xl px-12">
          Débloquer mon mytho
          <span className="text-3xl">→</span>
        </Button>

        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-text-secondary">
          <span className="w-4 h-4 bg-lime/20 rounded-full flex items-center justify-center">
            <span className="w-2 h-2 bg-lime rounded-full" />
          </span>
          <span>Satisfait ou remboursé</span>
        </div>
      </motion.div>
    </div>
  )
}
