import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, User } from '@/lib/supabase'
import { generateMytho, uploadToSupabase, AspectRatio } from '@/lib/kie-api'
import { saveMythoToCloud } from '@/lib/mythos-sync'
import { convertToJpeg } from '@/lib/image-utils'
import AspectRatioSelector from '@/components/AspectRatioSelector'
import { cachePlanLocally } from '@/lib/plan'

const CREDITS_PER_IMAGE = 8

async function downloadDataUrl(dataUrl: string, filename = `mytho-${Date.now()}.jpg`) {
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
    const canShare =
      typeof navigator !== 'undefined' &&
      'canShare' in navigator &&
      (navigator as any).canShare?.({ files: [file] })
    if (canShare && 'share' in navigator) {
      await (navigator as any).share({ files: [file], title: 'GoMytho', text: 'Mon mytho' })
      return
    }
    const objectUrl = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(objectUrl)
  } catch (err) {
    console.error('download failed', err)
    alert('Impossible de télécharger l’image. Réessaye.')
  }
}

export default function AppCreate() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, setUser } = useOutletContext<{ user: User | null; setUser: (u: User) => void }>()

  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  // Photo 2 = scène cible (optionnelle, pour image-to-image avec Nano Banana 2)
  const [image2, setImage2] = useState<File | null>(null)
  const [imagePreview2, setImagePreview2] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16')
  const [pendingBanner, setPendingBanner] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isConverting2, setIsConverting2] = useState(false)
  const [step, setStep] = useState('')
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('pending')) {
      const savedPrompt = localStorage.getItem('gomytho_pending_prompt')
      const savedRatio = localStorage.getItem('gomytho_pending_ratio') as AspectRatio | null
      if (savedPrompt) {
        setPrompt(savedPrompt)
        setPendingBanner(true)
        if (savedRatio) setAspectRatio(savedRatio)
        localStorage.removeItem('gomytho_pending_prompt')
        localStorage.removeItem('gomytho_pending_ratio')
      }
    }
  }, [searchParams])

  useEffect(() => {
    return () => {
      if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  useEffect(() => {
    return () => {
      if (imagePreview2?.startsWith('blob:')) URL.revokeObjectURL(imagePreview2)
    }
  }, [imagePreview2])

  const cachedCreditsRaw = Number(localStorage.getItem('gomytho_user_credits') || 0)
  const cachedCredits = Number.isFinite(cachedCreditsRaw) ? cachedCreditsRaw : 0
  const credits = Math.max(user?.credits_remaining ?? 0, cachedCredits)
  const canGenerate = !!image && !!prompt.trim() && !isGenerating && !isConverting

  const handleFile = async (file: File) => {
    setResultDataUrl(null)
    setIsConverting(true)
    try {
      const { file: jpeg, preview } = await convertToJpeg(file)
      const safePreview = preview || URL.createObjectURL(jpeg || file)
      setImage(jpeg)
      setImagePreview(safePreview)
    } finally {
      setIsConverting(false)
    }
  }

  const handleFile2 = async (file: File) => {
    setResultDataUrl(null)
    setIsConverting2(true)
    try {
      const { file: jpeg, preview } = await convertToJpeg(file)
      const safePreview = preview || URL.createObjectURL(jpeg || file)
      setImage2(jpeg)
      setImagePreview2(safePreview)
    } finally {
      setIsConverting2(false)
    }
  }

  const removeImage2 = () => {
    setImage2(null)
    setImagePreview2(null)
  }

  const handleGenerate = async () => {
    if (!image || !prompt.trim()) {
      alert('Ajoute une photo et un prompt avant de générer.')
      return
    }
    setIsGenerating(true)
    setResultDataUrl(null)
    try {
      let activeUser = user
      if (!activeUser) {
        const { data: sessionData } = await supabase.auth.getSession()
        const sessionUser = sessionData?.session?.user
        if (!sessionUser) {
          alert('Session expirée. Reconnecte-toi.')
          window.location.href = '/login'
          return
        }
        activeUser = {
          id: sessionUser.id,
          email: sessionUser.email || '',
          credits_remaining: credits,
          created_at: new Date().toISOString(),
          subscription_status: 'active',
          plan: (localStorage.getItem('gomytho_user_plan') as 'weekly' | 'monthly' | 'free') || 'monthly',
        }
        setUser(activeUser as User)
      }

      const availableCredits = credits
      if (availableCredits < CREDITS_PER_IMAGE) {
        alert('Crédits insuffisants pour générer ce mytho.')
        navigate('/settings')
        return
      }

      // 1) Upload de la photo source (et de la 2e photo si présente) vers Supabase
      setStep(image2 ? 'Upload des photos...' : 'Upload de ta photo...')
      const sourceUrl = await uploadToSupabase(image, activeUser.id)
      let sourceUrl2: string | null = null
      if (image2) {
        sourceUrl2 = await uploadToSupabase(image2, activeUser.id)
      }
      const imageUrls = sourceUrl2 ? [sourceUrl, sourceUrl2] : [sourceUrl]

      // 2) Génération IA — retourne TOUJOURS un dataUrl base64 prêt à afficher
      setStep('Génération IA...')
      const { dataUrl } = await generateMytho(
        { userPrompt: prompt, imageUrls, aspectRatio },
        (s) => setStep(s)
      )

      // 3) Affichage immédiat depuis la copie locale base64
      setResultDataUrl(dataUrl)

      // 4) Sauvegarde cloud (manifeste Supabase Storage) + cache local
      setStep('Sauvegarde...')
      await saveMythoToCloud({
        userId: activeUser.id,
        generatedDataUrl: dataUrl,
        prompt,
      })

      // 5) Décrément des crédits en DB (cross-device) — non bloquant
      const newCredits = availableCredits - CREDITS_PER_IMAGE
      try {
        await supabase
          .from('users')
          .update({ credits_remaining: newCredits })
          .eq('id', activeUser.id)
      } catch (dbErr) {
        console.warn('Décrément crédits DB échoué (non bloquant) :', dbErr)
      }

      setUser({ ...activeUser, credits_remaining: newCredits })
      cachePlanLocally(
        (activeUser.plan as 'weekly' | 'monthly' | 'free' | undefined) || 'monthly',
        newCredits
      )
    } catch (err: unknown) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Erreur inconnue'
      alert(`Erreur lors de la génération IA (${step || 'initialisation'}) : ${msg}`)
    } finally {
      setIsGenerating(false)
      setStep('')
    }
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      {pendingBanner && (
        <div
          className="rounded-2xl p-4 mb-5 flex items-center gap-3"
          style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.3)' }}
        >
          <span className="text-2xl">🎯</span>
          <div>
            <p className="text-lime font-bold text-sm">Ton prompt a été récupéré !</p>
            <p className="text-text-secondary text-xs">Upload ta photo pour lancer la génération</p>
          </div>
          <button onClick={() => setPendingBanner(false)} className="ml-auto text-text-secondary text-lg">×</button>
        </div>
      )}

      {/* Crédits */}
      <div
        className="rounded-2xl p-4 mb-5 flex items-center justify-between"
        style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.1)' }}
      >
        <div>
          <p className="text-xs text-text-secondary uppercase tracking-widest mb-0.5">Crédits restants</p>
          <p className="text-2xl font-black text-white">
            {credits} <span className="text-sm font-normal text-text-secondary">/ {CREDITS_PER_IMAGE} par image</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-text-secondary">
            ≈ {Math.floor(credits / CREDITS_PER_IMAGE)} mytho
            {Math.floor(credits / CREDITS_PER_IMAGE) > 1 ? 's' : ''} restant
            {Math.floor(credits / CREDITS_PER_IMAGE) > 1 ? 's' : ''}
          </p>
          {credits < CREDITS_PER_IMAGE && (
            <button onClick={() => navigate('/settings')} className="text-xs text-lime font-bold mt-1">
              Recharger →
            </button>
          )}
        </div>
      </div>

      {/* Résultat */}
      <AnimatePresence>
        {resultDataUrl && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-5 rounded-2xl overflow-hidden"
            style={{ border: '1.5px solid rgba(198,255,60,0.4)', boxShadow: '0 0 30px rgba(198,255,60,0.15)' }}
          >
            <img src={resultDataUrl} alt="Résultat" className="w-full" />
            <div className="px-4 pt-3 pb-1 text-center" style={{ background: '#141826' }}>
              <p className="text-lime text-xs font-bold animate-pulse">✅ Mytho prêt — tu peux le télécharger maintenant</p>
            </div>
            <div className="p-4 flex gap-3" style={{ background: '#141826' }}>
              <button
                onClick={() => downloadDataUrl(resultDataUrl)}
                className="flex-1 py-3 rounded-xl font-black bg-lime text-primary-bg text-center active:scale-95 transition-all text-sm"
              >
                ⬇️ Télécharger
              </button>
              <a
                href="/resultats"
                className="flex-1 py-3 rounded-xl font-bold text-sm active:scale-95 transition-all text-center"
                style={{ background: 'rgba(198,255,60,0.08)', color: '#C6FF3C', border: '1px solid rgba(198,255,60,0.2)' }}
              >
                🎨 Voir tout
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loader */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mb-5 rounded-2xl p-6 text-center"
            style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)' }}
          >
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lime mx-auto mb-3" />
            <p className="text-sm font-semibold text-lime">{step || 'Génération en cours...'}</p>
            <p className="text-xs text-text-secondary mt-1">~15 secondes</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload zone */}
      {!imagePreview ? (
        <div
          onClick={() => !isConverting && document.getElementById('file-upload-app')?.click()}
          className="rounded-2xl p-10 text-center cursor-pointer active:scale-95 transition-all mb-5"
          style={{ background: 'rgba(20,24,38,0.5)', border: '2px dashed rgba(198,255,60,0.2)' }}
        >
          {isConverting ? (
            <>
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lime mx-auto mb-3" />
              <p className="text-lime font-bold text-sm">Traitement de la photo...</p>
            </>
          ) : (
            <>
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl"
                style={{ background: 'rgba(198,255,60,0.08)' }}
              >
                📷
              </div>
              <p className="font-bold mb-1">Sélectionne ta photo</p>
              <p className="text-xs text-text-secondary">Galerie, caméra — tous formats acceptés</p>
            </>
          )}
          <input
            id="file-upload-app"
            type="file"
            accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp"
            className="hidden"
            onChange={async (e) => {
              if (e.target.files?.[0]) await handleFile(e.target.files[0])
            }}
          />
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden mb-3" style={{ border: '1px solid rgba(198,255,60,0.2)' }}>
          <div
            className="absolute top-2 left-2 z-10 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{ background: 'rgba(10,14,26,0.85)', color: '#C6FF3C', border: '1px solid rgba(198,255,60,0.3)' }}
          >
            Photo 1 · Sujet
          </div>
          <img src={imagePreview} alt="Preview" className="w-full max-h-56 object-cover" />
          <button
            onClick={() => {
              setImage(null)
              setImagePreview(null)
            }}
            className="absolute top-2 right-2 px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ background: 'rgba(10,14,26,0.85)', color: '#C6FF3C', border: '1px solid rgba(198,255,60,0.3)' }}
          >
            Changer
          </button>
        </div>
      )}

      {/* Photo 2 — optionnelle, image-to-image (Nano Banana 2) */}
      {imagePreview && (
        <div className="mb-5">
          {!imagePreview2 ? (
            <div
              onClick={() => !isConverting2 && document.getElementById('file-upload-app-2')?.click()}
              className="rounded-2xl p-5 text-center cursor-pointer active:scale-95 transition-all"
              style={{ background: 'rgba(20,24,38,0.35)', border: '2px dashed rgba(198,255,60,0.18)' }}
            >
              {isConverting2 ? (
                <>
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-lime mx-auto mb-2" />
                  <p className="text-lime font-bold text-xs">Traitement...</p>
                </>
              ) : (
                <>
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 text-xl"
                    style={{ background: 'rgba(198,255,60,0.06)', border: '1px solid rgba(198,255,60,0.15)' }}
                  >
                    🪄
                  </div>
                  <p className="font-bold text-sm mb-0.5">+ Ajouter une 2<sup>e</sup> photo (optionnel)</p>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Pour fusionner deux images. Ex&nbsp;: <em>"Mets cet homme sur cette plage"</em><br />
                    Photo 1 = le sujet · Photo 2 = la scène
                  </p>
                </>
              )}
              <input
                id="file-upload-app-2"
                type="file"
                accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.[0]) await handleFile2(e.target.files[0])
                }}
              />
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(198,255,60,0.2)' }}>
              <div
                className="absolute top-2 left-2 z-10 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                style={{ background: 'rgba(10,14,26,0.85)', color: '#C6FF3C', border: '1px solid rgba(198,255,60,0.3)' }}
              >
                Photo 2 · Scène
              </div>
              <img src={imagePreview2} alt="Preview 2" className="w-full max-h-56 object-cover" />
              <button
                onClick={removeImage2}
                className="absolute top-2 right-2 px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ background: 'rgba(10,14,26,0.85)', color: '#C6FF3C', border: '1px solid rgba(198,255,60,0.3)' }}
              >
                Retirer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Format */}
      <div className="mb-4">
        <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
      </div>

      {/* Prompt */}
      <div className="mb-5">
        <label className="block text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">
          Décris ton mytho
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            imagePreview2
              ? 'Ex (2 photos) : "Mets cet homme sur cette plage"\n"Place ce sac dans cette voiture"'
              : 'Ex : "Mets-moi une Rolex sur le poignet"\n"Ajoute un dinosaure dans le salon"'
          }
          rows={3}
          className="w-full rounded-2xl px-4 py-3 text-sm text-text-primary resize-none focus:outline-none transition-all"
          style={{ background: '#141826', border: '1.5px solid rgba(198,255,60,0.15)' }}
          onFocus={(e) => (e.target.style.borderColor = 'rgba(198,255,60,0.5)')}
          onBlur={(e) => (e.target.style.borderColor = 'rgba(198,255,60,0.15)')}
        />
        {imagePreview2 && (
          <p className="mt-2 text-[11px] text-text-secondary leading-relaxed">
            💡 Mode 2 photos&nbsp;: <strong>Photo 1 = le sujet</strong>, <strong>Photo 2 = la scène</strong>. L'IA fusionne les deux.
          </p>
        )}
      </div>

      {/* CTA */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="w-full py-4 rounded-full font-black text-lg text-primary-bg bg-lime active:scale-95 transition-all disabled:opacity-40"
        style={{ boxShadow: canGenerate ? '0 0 40px rgba(198,255,60,0.4)' : 'none' }}
      >
        {isGenerating ? '⏳ Génération...' : `✨ Générer — ${CREDITS_PER_IMAGE} crédits`}
      </button>
      {credits < CREDITS_PER_IMAGE && !isGenerating && (
        <p className="text-center text-xs text-red-400 mt-2">
          Crédits insuffisants ·{' '}
          <button onClick={() => navigate('/settings')} className="underline">
            Gérer l'abonnement
          </button>
        </p>
      )}
    </div>
  )
}
