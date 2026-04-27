import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, User } from '@/lib/supabase'
import { generateImage, uploadToSupabase, persistGeneratedImage, AspectRatio } from '@/lib/kie-api'
import { convertToJpeg } from '@/lib/image-utils'
import AspectRatioSelector from '@/components/AspectRatioSelector'

const CREDITS_PER_IMAGE = 8
const USE_USERS_TABLE = import.meta.env.VITE_USE_USERS_TABLE === 'true'

export default function AppCreate() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, setUser } = useOutletContext<{ user: User | null; setUser: (u: User) => void }>()

  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16')
  const [pendingBanner, setPendingBanner] = useState(false)

  useEffect(() => {
    // Pré-remplir avec le prompt sauvegardé avant le paiement
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
      if (imagePreview?.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview)
      }
    }
  }, [imagePreview])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [step, setStep] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultPreviewDataUrl, setResultPreviewDataUrl] = useState<string | null>(null)

  const normalizeStorageUrl = (url: string) => {
    if (!url) return url
    return url
      .replace('/object/public/mythos%20/', '/object/public/mythos/')
      .replace('/object/public/mythos%2520/', '/object/public/mythos/')
  }

  const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const res = await fetch(dataUrl)
    return res.blob()
  }

  const downloadBlob = async (blob: Blob, filename: string) => {
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
    const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator && (navigator as any).canShare?.({ files: [file] })
    if (canShare && 'share' in navigator) {
      await (navigator as any).share({ files: [file], title: 'GoMytho', text: 'Ton mytho est prêt' })
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
  }

  const forceDownload = async (
    url: string,
    previewDataUrl?: string | null,
    filename = `mytho-${Date.now()}.jpg`
  ) => {
    if (!url && !previewDataUrl) return
    try {
      if (previewDataUrl?.startsWith('data:image/')) {
        const blob = await dataUrlToBlob(previewDataUrl)
        await downloadBlob(blob, filename)
        return
      }
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      await downloadBlob(blob, filename)
    } catch (error) {
      console.error('download failed', error)
      alert('Le fichier n’est plus disponible au téléchargement (404). Regénère un nouveau mytho.')
    }
  }

  const cachedCreditsRaw = Number(localStorage.getItem('gomytho_user_credits') || 0)
  const cachedCredits = Number.isFinite(cachedCreditsRaw) ? cachedCreditsRaw : 0
  const credits = Math.max(user?.credits_remaining ?? 0, cachedCredits)
  const canGenerate = !!image && !!prompt.trim() && !isGenerating && !isConverting

  const urlToDataUrl = async (url: string): Promise<string | null> => {
    try {
      if (url.startsWith('data:image/')) return url
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) return null
      const blob = await response.blob()
      return await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch {
      try {
        const proxyRes = await fetch('/api/image-copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: url }),
        })
        const payload = await proxyRes.json().catch(() => ({}))
        if (!proxyRes.ok) return null
        return typeof payload?.dataUrl === 'string' ? payload.dataUrl : null
      } catch {
        return null
      }
    }
  }

  const saveLocalCreation = (
    userId: string,
    imageUrl: string,
    userPrompt: string,
    previewDataUrl?: string | null
  ) => {
    const key = `gomytho_creations_${userId}`
    const raw = localStorage.getItem(key)
    const list = raw ? JSON.parse(raw) as Array<{ id: string; user_id: string; image_url: string; prompt: string; created_at: string; preview_data_url?: string }> : []
    const entry = {
      id: `local-${Date.now()}`,
      user_id: userId,
      image_url: imageUrl,
      preview_data_url: previewDataUrl || undefined,
      prompt: userPrompt,
      created_at: new Date().toISOString(),
    }
    localStorage.setItem(key, JSON.stringify([entry, ...list].slice(0, 200)))
  }

  const handleFile = async (file: File) => {
    setResultUrl(null)
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

  const handleGenerate = async () => {
    if (!image || !prompt.trim()) {
      alert('Ajoute une photo et un prompt avant de générer.')
      return
    }
    setIsGenerating(true)
    setResultUrl(null)
    setResultPreviewDataUrl(null)
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

      // Crédits depuis contexte/cache (évite dépendance table users manquante)
      let availableCredits = credits

      if (availableCredits < CREDITS_PER_IMAGE) {
        alert('Crédits insuffisants pour générer ce mytho.')
        navigate('/settings')
        return
      }

      setStep('Upload de ta photo...')
      let url = ''
      let inputImage = imagePreview || ''

      // 1) Tentative directe avec image locale (évite dépendance Storage)
      try {
        if (!inputImage) throw new Error('No local preview')
        setStep('Envoi direct à l’IA...')
        url = await generateImage(
          { userPrompt: prompt, imageUrl: inputImage, aspectRatio },
          (s) => setStep(s)
        )
      } catch {
        // 2) Fallback upload + URL publique
        setStep('Upload de ta photo...')
        const publicUrl = await uploadToSupabase(image, activeUser.id)
        setStep('Génération IA...')
        url = await generateImage(
          { userPrompt: prompt, imageUrl: publicUrl, aspectRatio },
          (s) => setStep(s)
        )
      }

      setStep('Stabilisation du résultat...')
      const stableUrlRaw = await persistGeneratedImage(url, activeUser.id)
      const stableUrl = normalizeStorageUrl(stableUrlRaw)
      setResultUrl(stableUrl)
      const previewDataUrl = await urlToDataUrl(url) || await urlToDataUrl(stableUrl)
      setResultPreviewDataUrl(previewDataUrl)
      saveLocalCreation(activeUser.id, stableUrl, prompt, previewDataUrl)

      // Sauvegarde DB NON bloquante
      const insertRes = await supabase.from('mythos').insert([{ user_id: activeUser.id, image_url: stableUrl, prompt }])
      let updateErrorMessage: string | undefined
      if (USE_USERS_TABLE) {
        const updateRes = await supabase.from('users').update({ credits_remaining: availableCredits - CREDITS_PER_IMAGE }).eq('id', activeUser.id)
        updateErrorMessage = updateRes.error?.message
      }
      if (insertRes.error || updateErrorMessage) {
        console.warn('DB save warning:', { insertError: insertRes.error?.message, updateError: updateErrorMessage })
      }

      setUser({ ...activeUser, credits_remaining: availableCredits - CREDITS_PER_IMAGE })
      localStorage.setItem('gomytho_user_credits', String(availableCredits - CREDITS_PER_IMAGE))

      // On reste sur la page pour afficher le résultat et laisser télécharger directement.
    } catch (err: unknown) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Erreur inconnue'
      if (/bucket supabase introuvable|bucket.*not found/i.test(msg)) {
        alert(`Configuration Supabase manquante : ${msg}`)
        return
      }
      alert(`Erreur lors de la génération IA (${step || 'initialisation'}) : ${msg}`)
    } finally {
      setIsGenerating(false)
      setStep('')
    }
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">

      {/* Bannière prompt pré-rempli */}
      {pendingBanner && (
        <div className="rounded-2xl p-4 mb-5 flex items-center gap-3" style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.3)' }}>
          <span className="text-2xl">🎯</span>
          <div>
            <p className="text-lime font-bold text-sm">Ton prompt a été récupéré !</p>
            <p className="text-text-secondary text-xs">Upload ta photo pour lancer la génération</p>
          </div>
          <button onClick={() => setPendingBanner(false)} className="ml-auto text-text-secondary text-lg">×</button>
        </div>
      )}

      {/* Crédits restants */}
      <div className="rounded-2xl p-4 mb-5 flex items-center justify-between"
        style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.1)' }}>
        <div>
          <p className="text-xs text-text-secondary uppercase tracking-widest mb-0.5">Crédits restants</p>
          <p className="text-2xl font-black text-white">{credits} <span className="text-sm font-normal text-text-secondary">/ {CREDITS_PER_IMAGE} par image</span></p>
        </div>
        <div className="text-right">
          <p className="text-xs text-text-secondary">≈ {Math.floor(credits / CREDITS_PER_IMAGE)} mytho{Math.floor(credits / CREDITS_PER_IMAGE) > 1 ? 's' : ''} restant{Math.floor(credits / CREDITS_PER_IMAGE) > 1 ? 's' : ''}</p>
          {credits < CREDITS_PER_IMAGE && (
            <button onClick={() => navigate('/settings')} className="text-xs text-lime font-bold mt-1">
              Recharger →
            </button>
          )}
        </div>
      </div>

      {/* Résultat */}
      <AnimatePresence>
        {(resultUrl || resultPreviewDataUrl) && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-5 rounded-2xl overflow-hidden" style={{ border: '1.5px solid rgba(198,255,60,0.4)', boxShadow: '0 0 30px rgba(198,255,60,0.15)' }}>
            <img src={resultPreviewDataUrl || resultUrl || ''} alt="Résultat" className="w-full" />
            <div className="px-4 pt-3 pb-1 text-center" style={{ background: '#141826' }}>
              <p className="text-lime text-xs font-bold animate-pulse">✅ Mytho prêt — tu peux le télécharger maintenant</p>
            </div>
            <div className="p-4 flex gap-3" style={{ background: '#141826' }}>
              <button
                onClick={() => forceDownload(resultUrl || '', resultPreviewDataUrl)}
                className="flex-1 py-3 rounded-xl font-black bg-lime text-primary-bg text-center active:scale-95 transition-all text-sm"
              >
                ⬇️ Télécharger
              </button>
              <a href="/resultats" className="flex-1 py-3 rounded-xl font-bold text-sm active:scale-95 transition-all text-center" style={{ background: 'rgba(198,255,60,0.08)', color: '#C6FF3C', border: '1px solid rgba(198,255,60,0.2)' }}>
                🎨 Voir tout
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loader */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-5 rounded-2xl p-6 text-center" style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)' }}>
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
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl" style={{ background: 'rgba(198,255,60,0.08)' }}>📷</div>
              <p className="font-bold mb-1">Sélectionne ta photo</p>
              <p className="text-xs text-text-secondary">Galerie, caméra — tous formats acceptés</p>
            </>
          )}
          <input
            id="file-upload-app"
            type="file"
            accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp"
            className="hidden"
            onChange={async e => { if (e.target.files?.[0]) await handleFile(e.target.files[0]) }}
          />
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden mb-5" style={{ border: '1px solid rgba(198,255,60,0.2)' }}>
          <img src={imagePreview} alt="Preview" className="w-full max-h-56 object-cover" />
          <button onClick={() => { setImage(null); setImagePreview(null) }}
            className="absolute top-2 right-2 px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ background: 'rgba(10,14,26,0.85)', color: '#C6FF3C', border: '1px solid rgba(198,255,60,0.3)' }}>
            Changer
          </button>
        </div>
      )}

      {/* Format */}
      <div className="mb-4">
        <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
      </div>

      {/* Prompt */}
      <div className="mb-5">
        <label className="block text-xs font-bold uppercase tracking-widest text-text-secondary mb-2">Décris ton mytho</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={'Ex : "Mets-moi une Rolex sur le poignet"\n"Ajoute un dinosaure dans le salon"'}
          rows={3}
          className="w-full rounded-2xl px-4 py-3 text-sm text-text-primary resize-none focus:outline-none transition-all"
          style={{ background: '#141826', border: '1.5px solid rgba(198,255,60,0.15)' }}
          onFocus={e => (e.target.style.borderColor = 'rgba(198,255,60,0.5)')}
          onBlur={e => (e.target.style.borderColor = 'rgba(198,255,60,0.15)')}
        />
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
        <p className="text-center text-xs text-red-400 mt-2">Crédits insuffisants · <button onClick={() => navigate('/settings')} className="underline">Gérer l'abonnement</button></p>
      )}
    </div>
  )
}
