import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, User } from '@/lib/supabase'
import { generateImage, uploadToSupabase, AspectRatio } from '@/lib/kie-api'
import { convertToJpeg } from '@/lib/image-utils'
import AspectRatioSelector from '@/components/AspectRatioSelector'

const CREDITS_PER_IMAGE = 8

export default function AppCreate() {
  const navigate = useNavigate()
  const { user, setUser } = useOutletContext<{ user: User | null; setUser: (u: User) => void }>()

  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16')
  const [isGenerating, setIsGenerating] = useState(false)
  const [step, setStep] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)

  const credits = user?.credits_remaining ?? 0
  const canGenerate = !!image && !!prompt.trim() && credits >= CREDITS_PER_IMAGE && !isGenerating

  const handleFile = async (file: File) => {
    setResultUrl(null)
    // Convertir en JPEG (gère HEIC/HEIF galerie iPhone, WebP, etc.)
    const jpeg = await convertToJpeg(file)
    setImage(jpeg)
    const reader = new FileReader()
    reader.onloadend = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(jpeg)
  }

  const handleGenerate = async () => {
    if (!image || !prompt || !user) return
    setIsGenerating(true)
    setResultUrl(null)
    try {
      setStep('Upload de ta photo...')
      const publicUrl = await uploadToSupabase(image, user.id)

      const url = await generateImage(
        { userPrompt: prompt, imageUrl: publicUrl, aspectRatio },
        (s) => setStep(s)
      )

      setResultUrl(url)

      // Sauvegarder en base + déduire crédits
      await Promise.all([
        supabase.from('mythos').insert([{ user_id: user.id, image_url: url, prompt }]),
        supabase.from('users').update({ credits_remaining: credits - CREDITS_PER_IMAGE }).eq('id', user.id),
      ])

      setUser({ ...user, credits_remaining: credits - CREDITS_PER_IMAGE })

      // Rediriger vers les résultats après 2 secondes
      setTimeout(() => { window.location.href = '/resultats' }, 2000)
    } catch (err) {
      console.error(err)
      alert('Erreur lors de la génération. Réessaie.')
    } finally {
      setIsGenerating(false)
      setStep('')
    }
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">

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
        {resultUrl && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-5 rounded-2xl overflow-hidden" style={{ border: '1.5px solid rgba(198,255,60,0.4)', boxShadow: '0 0 30px rgba(198,255,60,0.15)' }}>
            <img src={resultUrl} alt="Résultat" className="w-full" />
            <div className="px-4 pt-3 pb-1 text-center" style={{ background: '#141826' }}>
              <p className="text-lime text-xs font-bold animate-pulse">✅ Sauvegardé — redirection vers tes résultats...</p>
            </div>
            <div className="p-4 flex gap-3" style={{ background: '#141826' }}>
              <a href={resultUrl} download={`mytho-${Date.now()}.jpg`} className="flex-1 py-3 rounded-xl font-black bg-lime text-primary-bg text-center active:scale-95 transition-all text-sm">
                ⬇️ Télécharger
              </a>
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
          onClick={() => document.getElementById('file-upload-app')?.click()}
          className="rounded-2xl p-10 text-center cursor-pointer active:scale-95 transition-all mb-5"
          style={{ background: 'rgba(20,24,38,0.5)', border: '2px dashed rgba(198,255,60,0.2)' }}
        >
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl" style={{ background: 'rgba(198,255,60,0.08)' }}>📷</div>
          <p className="font-bold mb-1">Sélectionne ta photo</p>
          <p className="text-xs text-text-secondary">ou glisse-dépose ici</p>
          <input id="file-upload-app" type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
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
