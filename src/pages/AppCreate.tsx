import { useState, useEffect, useRef } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, User } from '@/lib/supabase'
import { generateMytho, uploadToSupabase, AspectRatio, KieBlockedError } from '@/lib/kie-api'
import { saveMythoToCloud } from '@/lib/mythos-sync'
import { convertToJpeg } from '@/lib/image-utils'
import AspectRatioSelector from '@/components/AspectRatioSelector'
import PhotoCard from '@/components/PhotoCard'
import GenErrorBanner, { setGenError, clearGenError } from '@/components/GenErrorBanner'
import { cachePlanLocally, CREDITS_PER_IMAGE } from '@/lib/plan'

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
  // Référence sync sur l'étape en cours : setStep est asynchrone (re-render
  // React), donc lire `step` dans un catch capture l'ancienne valeur via la
  // closure → on lisait toujours '' et l'erreur disait "initialisation" alors
  // que la vraie étape pouvait être "Upload" / "Génération IA" / "Sauvegarde".
  const currentStepRef = useRef('')
  const updateStep = (label: string) => {
    currentStepRef.current = label
    setStep(label)
  }
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null)
  const [bannerKey, setBannerKey] = useState(0)

  useEffect(() => {
    // 1) Mode `?pending=` : utilisateur revient pour finaliser → on consomme.
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
      return
    }

    // 2) Sans `?pending=` : si une auto-gen a échoué (les pending data sont
    // toujours là), on les pré-remplit pour que le user puisse relancer en 1 clic.
    const savedImage = localStorage.getItem('gomytho_pending_image')
    const savedImage2 = localStorage.getItem('gomytho_pending_image2')
    const savedPrompt = localStorage.getItem('gomytho_pending_prompt')
    const savedRatio = localStorage.getItem('gomytho_pending_ratio') as AspectRatio | null
    if (savedImage && savedPrompt) {
      ;(async () => {
        try {
          const r = await fetch(savedImage)
          const b = await r.blob()
          const f = new File([b], 'photo.jpg', { type: b.type || 'image/jpeg' })
          setImage(f)
          setImagePreview(savedImage)
        } catch (e) {
          console.warn('[AppCreate] restore image pending échoué:', e)
        }
        if (savedImage2) {
          try {
            const r2 = await fetch(savedImage2)
            const b2 = await r2.blob()
            const f2 = new File([b2], 'photo2.jpg', { type: b2.type || 'image/jpeg' })
            setImage2(f2)
            setImagePreview2(savedImage2)
          } catch (e2) {
            console.warn('[AppCreate] restore image2 pending échoué:', e2)
          }
        }
        setPrompt(savedPrompt)
        if (savedRatio) setAspectRatio(savedRatio)
        setPendingBanner(true)
      })()
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
    // Nouvelle tentative → on efface le banner d'erreur précédent.
    clearGenError()
    setBannerKey((k) => k + 1)
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

      // Helper retry (3 tentatives + backoff exponentiel) — on ne veut pas
      // qu'une coupure réseau temporaire fasse échouer la génération.
      // Pas de retry sur un blocage de modération : Kie.ai répondra pareil.
      const withRetry = async <T,>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> => {
        let lastErr: unknown = null
        for (let i = 1; i <= attempts; i += 1) {
          try {
            const r = await fn()
            if (i > 1) console.info(`[AppCreate] ${label} → réussi après ${i} tentatives`)
            return r
          } catch (err) {
            lastErr = err
            if (err instanceof KieBlockedError) throw err
            console.warn(`[AppCreate] ${label} échec ${i}/${attempts}:`, err)
            if (i < attempts) {
              const delay = Math.min(8000, 1500 * Math.pow(2, i - 1))
              await new Promise((r) => setTimeout(r, delay))
            }
          }
        }
        throw lastErr
      }

      // 1) Upload de la photo source (et de la 2e photo si présente) vers Supabase
      updateStep(image2 ? 'Upload des photos...' : 'Upload de ta photo...')
      const sourceUrl = await withRetry('upload photo 1', () => uploadToSupabase(image, activeUser!.id))
      let sourceUrl2: string | null = null
      if (image2) {
        try {
          sourceUrl2 = await withRetry('upload photo 2', () => uploadToSupabase(image2, activeUser!.id))
        } catch (e2) {
          console.warn('[AppCreate] upload photo 2 abandonné, on continue avec la photo 1 seule:', e2)
        }
      }
      const imageUrls = sourceUrl2 ? [sourceUrl, sourceUrl2] : [sourceUrl]

      // 2) Génération IA — retourne TOUJOURS un dataUrl base64 prêt à afficher
      updateStep('Génération IA...')
      const { dataUrl, remoteUrl } = await withRetry(
        'generateMytho',
        () =>
          generateMytho(
            { userPrompt: prompt, imageUrls, aspectRatio },
            (s) => updateStep(s)
          ),
        2
      )

      // 3) Affichage immédiat depuis la copie locale base64
      setResultDataUrl(dataUrl)

      // 4) Sauvegarde cloud (manifeste Supabase Storage) + cache local
      updateStep('Sauvegarde...')
      try {
        await withRetry(
          'saveMythoToCloud',
          () => saveMythoToCloud({ userId: activeUser!.id, generatedDataUrl: dataUrl, prompt }),
          2
        )
      } catch (saveErr) {
        // L'image existe → on la met quand même dans le cache local pour qu'elle
        // apparaisse dans Créations au prochain refresh.
        console.warn('[AppCreate] saveMythoToCloud KO, fallback cache local:', saveErr)
        try {
          const { readLocalCreations, writeLocalCreations } = await import('@/lib/mythos-sync')
          const list = readLocalCreations(activeUser.id)
          writeLocalCreations(activeUser.id, [
            {
              id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              user_id: activeUser.id,
              image_url: remoteUrl || dataUrl,
              preview_data_url: dataUrl,
              prompt,
              created_at: new Date().toISOString(),
            },
            ...list,
          ])
        } catch (cacheErr) {
          console.error('[AppCreate] fallback cache local KO:', cacheErr)
        }
      }

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

      // Génération manuelle réussie → on nettoie les pending laissés par
      // une éventuelle auto-gen précédente qui aurait échoué.
      try {
        localStorage.removeItem('gomytho_pending_image')
        localStorage.removeItem('gomytho_pending_image2')
        localStorage.removeItem('gomytho_pending_prompt')
        localStorage.removeItem('gomytho_pending_ratio')
      } catch { /* ignore */ }
    } catch (err: unknown) {
      console.error('[AppCreate] generation error:', err, '— step:', currentStepRef.current)
      if (err instanceof KieBlockedError) {
        setGenError({ code: err.code, message: err.message, blocked: true })
      } else {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue'
        const stepLabel = currentStepRef.current || 'préparation'
        // On affiche le détail technique court à l'utilisateur SEULEMENT si
        // ça aide ; sinon message générique mais actionnable.
        const friendly = msg.includes('Crédits Kie')
          ? msg
          : msg.toLowerCase().includes('quota')
          ? "Espace local saturé. Recharge la page (Cmd+Shift+R) puis relance la génération."
          : msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch')
          ? `Problème de connexion pendant l'étape "${stepLabel}". Vérifie ta connexion et clique sur Générer à nouveau.`
          : `Échec à l'étape "${stepLabel}". Réessaie en cliquant sur Générer ; si ça persiste, change ta photo ou ton prompt.`
        setGenError({ code: 'GEN_FAILED', message: friendly, blocked: false })
      }
      // Force le re-render du banner (sans recharger la page)
      setBannerKey((k) => k + 1)
    } finally {
      setIsGenerating(false)
      currentStepRef.current = ''
      setStep('')
    }
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      {/* Banner d'erreur de génération (modération IA, fail réseau, etc.) */}
      {/* Auto-dismiss 15s : l'utilisateur a vu l'erreur, on libère l'espace
          plutôt que de laisser un bandeau permanent au-dessus du formulaire. */}
      <GenErrorBanner key={bannerKey} showRetryCta={false} autoDismissMs={15000} />

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

      {/* Upload — grille 2 colonnes Sujet + Scène (toujours affichée) */}
      <div className="mb-5">
        <div className="grid grid-cols-2 gap-3">
          <PhotoCard
            label="Photo 1"
            sublabel="Sujet"
            required
            preview={imagePreview}
            isConverting={isConverting}
            onChange={() => {
              setImage(null)
              setImagePreview(null)
            }}
            onClick={() => !isConverting && document.getElementById('file-upload-app')?.click()}
          />
          <input
            id="file-upload-app"
            type="file"
            accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp"
            className="hidden"
            onChange={async (e) => {
              if (e.target.files?.[0]) await handleFile(e.target.files[0])
            }}
          />

          <PhotoCard
            label="Photo 2"
            sublabel="Scène"
            optional
            preview={imagePreview2}
            isConverting={isConverting2}
            onChange={removeImage2}
            onClick={() => !isConverting2 && document.getElementById('file-upload-app-2')?.click()}
          />
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

        <p className="mt-3 text-center text-[11px] text-text-secondary leading-relaxed">
          {imagePreview2 ? (
            <>
              ✨ <span className="text-lime font-semibold">Mode fusion activé</span> · l'IA placera ton sujet dans la scène
            </>
          ) : imagePreview ? (
            <>Ajoute une 2<sup>e</sup> photo pour fusionner — ex&nbsp;: <em>"Mets cet homme sur cette plage"</em></>
          ) : (
            <>La <strong>Photo 1</strong> est ton sujet · la <strong>Photo 2</strong> (optionnelle) est la scène où le placer</>
          )}
        </p>
      </div>

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
