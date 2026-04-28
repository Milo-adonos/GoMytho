import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoadingAnimation from '@/components/LoadingAnimation'

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

  useEffect(() => {
    const img = sessionStorage.getItem('uploadedImage')
    if (!img) {
      navigate('/uploadphoto', { replace: true })
      return
    }

    const totalDuration = 15000
    const stepDuration = totalDuration / loadingSteps.length

    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < loadingSteps.length - 1) return prev + 1
        return prev
      })
    }, stepDuration)

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 100) return prev + 100 / (totalDuration / 100)
        return 100
      })
    }, 100)

    const completeTimeout = setTimeout(() => {
      navigate('/choixoffre', { replace: true })
    }, totalDuration)

    return () => {
      clearInterval(stepInterval)
      clearInterval(progressInterval)
      clearTimeout(completeTimeout)
    }
  }, [navigate])

  return (
    <LoadingAnimation
      text={loadingSteps[currentStep]}
      progress={progress}
    />
  )
}
