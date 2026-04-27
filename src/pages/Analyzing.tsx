import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoadingAnimation from '@/components/LoadingAnimation'
import { motion } from 'framer-motion'

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
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState<string>('1:1')

  useEffect(() => {
    const img = sessionStorage.getItem('uploadedImage')
    if (!img) {
      navigate('/uploadphoto')
      return
    }
    setUploadedImage(img)
    setAspectRatio(sessionStorage.getItem('aspectRatio') || '1:1')

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
    navigate('/choixoffre')
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
    <div className="min-h-screen bg-primary-bg flex flex-col items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm text-center"
      >
        {/* Badge */}
        <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full text-xs font-bold"
          style={{ background: 'rgba(198,255,60,0.1)', border: '1px solid rgba(198,255,60,0.3)', color: '#C6FF3C' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-lime animate-pulse" />
          Ton mytho est prêt
        </div>

        {/* Image floutée avec cadenas — ratio selon le choix de l'utilisateur */}
        <div
          className="relative rounded-2xl overflow-hidden mb-6 mx-auto w-full"
          style={{
            border: '2px solid rgba(198,255,60,0.3)',
            boxShadow: '0 0 40px rgba(198,255,60,0.1)',
            aspectRatio: aspectRatio === '9:16' ? '9/16' : aspectRatio === '16:9' ? '16/9' : '1/1',
            maxHeight: aspectRatio === '9:16' ? '420px' : '280px',
            maxWidth: aspectRatio === '16:9' ? '100%' : aspectRatio === '9:16' ? '220px' : '300px',
          }}
        >
          {/* Photo uploadée floutée */}
          {uploadedImage && (
            <img
              src={uploadedImage}
              alt="Ton mytho"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(22px)', transform: 'scale(1.1)' }}
            />
          )}

          {/* Overlay sombre */}
          <div className="absolute inset-0" style={{ background: 'rgba(10,14,26,0.55)' }} />

          {/* Cadenas centré */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(198,255,60,0.15)',
                border: '2px solid #C6FF3C',
                boxShadow: '0 0 30px rgba(198,255,60,0.4)',
              }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#C6FF3C" strokeWidth="2.5" strokeLinecap="round"/>
                <rect x="3" y="11" width="18" height="11" rx="3" fill="rgba(198,255,60,0.15)" stroke="#C6FF3C" strokeWidth="2.5"/>
                <circle cx="12" cy="16.5" r="1.5" fill="#C6FF3C"/>
              </svg>
            </motion.div>
            <p className="text-white font-black text-lg" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
              Débloque pour voir
            </p>
          </div>
        </div>

        {/* Titre */}
        <h1 className="font-black mb-2" style={{ fontSize: 'clamp(28px, 8vw, 40px)' }}>
          Ton mytho est <span className="text-gradient-lime">prêt&nbsp;!</span>
        </h1>
        <p className="text-text-secondary text-sm mb-7">
          Débloque-le maintenant pour voir le résultat complet
        </p>

        {/* CTA */}
        <button
          onClick={handleUnlock}
          className="w-full py-4 text-lg font-black rounded-full bg-lime text-primary-bg active:scale-95 transition-all duration-200"
          style={{ boxShadow: '0 0 40px rgba(198,255,60,0.5), 0 0 80px rgba(198,255,60,0.2)' }}
        >
          🔓 Débloquer mon mytho →
        </button>

        {/* Garantie */}
        <p className="mt-4 text-xs text-text-secondary flex items-center justify-center gap-1.5">
          <span>🛡️</span> Satisfait ou remboursé — annulable en 1 clic
        </p>
      </motion.div>
    </div>
  )
}
