import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '@/components/Header'
import AspectRatioSelector from '@/components/AspectRatioSelector'
import PhotoCard from '@/components/PhotoCard'
import { AspectRatio } from '@/lib/kie-api'
import { convertToJpeg } from '@/lib/image-utils'

// localStorage.setItem qui ne perd JAMAIS la donnée pending : si on hit le
// quota, on purge progressivement les vieux caches non critiques (creations,
// preview cache, etc.) avant de re-tenter. C'est crucial : sans `pending_image`
// après paiement, l'auto-gen peut pas reconstruire le mytho.
function safeSetPending(key: string, value: string): boolean {
  const tryWrite = (): boolean => {
    try {
      localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  }
  if (tryWrite()) return true
  const purgeKeys = Object.keys(localStorage).filter(
    (k) =>
      k.startsWith('gomytho_creations_preview_') ||
      k.startsWith('gomytho_image_cache_') ||
      k.startsWith('gomytho_thumb_')
  )
  for (const k of purgeKeys) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
    if (tryWrite()) return true
  }
  // Dernière chance : purge le cache des créations (le user les retrouvera via cloud sync)
  const creationKeys = Object.keys(localStorage).filter((k) => k.startsWith('gomytho_creations_'))
  for (const k of creationKeys) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
    if (tryWrite()) return true
  }
  console.error('[Create] localStorage saturé, impossible de persister', key)
  return false
}

export default function Create() {
  const navigate = useNavigate()
  // Image 1 = sujet (obligatoire). Image 2 = scène cible (optionnel, image-to-image).
  // On ne garde le File que pour l'image 1 (utile pour son nom dans sessionStorage).
  // L'image 2 ne sert qu'à être persistée en data URL → on stocke uniquement la preview.
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imagePreview2, setImagePreview2] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16')
  const [isConverting, setIsConverting] = useState(false)
  const [isConverting2, setIsConverting2] = useState(false)

  const handleFile = async (file: File) => {
    setIsConverting(true)
    try {
      const { file: jpeg, preview } = await convertToJpeg(file)
      setImage(jpeg)
      setImagePreview(preview)
      safeSetPending('gomytho_pending_image', preview)
    } finally {
      setIsConverting(false)
    }
  }

  const handleFile2 = async (file: File) => {
    setIsConverting2(true)
    try {
      const { preview } = await convertToJpeg(file)
      setImagePreview2(preview)
      safeSetPending('gomytho_pending_image2', preview)
    } finally {
      setIsConverting2(false)
    }
  }

  const removeImage2 = () => {
    setImagePreview2(null)
    try { localStorage.removeItem('gomytho_pending_image2') } catch { /* ignore */ }
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) await handleFile(file)
  }

  const handleGenerate = () => {
    if (!image || !prompt.trim()) return
    sessionStorage.setItem('uploadedImage', imagePreview!)
    sessionStorage.setItem('uploadedImageName', image.name)
    sessionStorage.setItem('userPrompt', prompt)
    sessionStorage.setItem('aspectRatio', aspectRatio)
    if (imagePreview2) {
      sessionStorage.setItem('uploadedImage2', imagePreview2)
    } else {
      sessionStorage.removeItem('uploadedImage2')
    }
    // Persister aussi dans localStorage (survit au redirect Stripe)
    safeSetPending('gomytho_pending_prompt', prompt)
    safeSetPending('gomytho_pending_ratio', aspectRatio)
    if (imagePreview2) {
      safeSetPending('gomytho_pending_image2', imagePreview2)
    } else {
      try { localStorage.removeItem('gomytho_pending_image2') } catch { /* ignore */ }
    }
    // Sécurité supplémentaire : ré-écrit l'image 1 si elle a été perdue entretemps
    if (imagePreview && !localStorage.getItem('gomytho_pending_image')) {
      safeSetPending('gomytho_pending_image', imagePreview)
    }
    navigate('/chargementmytho')
  }

  return (
    <div className="min-h-screen bg-primary-bg">
      <Header showLogin={false} />

      <div className="pt-28 pb-20 px-4">
        <div className="max-w-lg mx-auto">

          {/* Titre */}
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-5xl font-black mb-2">Upload ta photo</h1>
            <p className="text-text-secondary">Plus elle est nette, plus le résultat sera bluffant</p>
          </div>

          {/* Zone d'upload — grille 2 colonnes (Sujet + Scène) toujours visible */}
          <div
            className="mb-6"
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
          >
            <div className="grid grid-cols-2 gap-3">
              {/* Carte Photo 1 — Sujet */}
              <PhotoCard
                label="Photo 1"
                sublabel="Sujet"
                required
                preview={imagePreview}
                isConverting={isConverting}
                onChange={() => { setImage(null); setImagePreview(null) }}
                onClick={() => !isConverting && document.getElementById('file-upload')?.click()}
              />
              <input
                id="file-upload"
                type="file"
                accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                onChange={async e => { if (e.target.files?.[0]) await handleFile(e.target.files[0]) }}
                className="hidden"
              />

              {/* Carte Photo 2 — Scène (optionnelle) */}
              <PhotoCard
                label="Photo 2"
                sublabel="Scène"
                optional
                preview={imagePreview2}
                isConverting={isConverting2}
                onChange={removeImage2}
                onClick={() => !isConverting2 && document.getElementById('file-upload-2')?.click()}
              />
              <input
                id="file-upload-2"
                type="file"
                accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                onChange={async e => { if (e.target.files?.[0]) await handleFile2(e.target.files[0]) }}
                className="hidden"
              />
            </div>

            {/* Légende sous les deux cartes */}
            <p className="mt-3 text-center text-xs text-text-secondary leading-relaxed">
              {imagePreview2 ? (
                <>✨ <span className="text-lime font-semibold">Mode fusion activé</span> · l'IA placera ton sujet dans la scène</>
              ) : imagePreview ? (
                <>Ajoute une 2<sup>e</sup> photo pour fusionner — ex&nbsp;: <em>"Mets cet homme sur cette plage"</em></>
              ) : (
                <>La <strong>Photo 1</strong> est ton sujet · la <strong>Photo 2</strong> (optionnelle) est la scène où le placer</>
              )}
            </p>
          </div>

          {imagePreview && (
            <>
              {/* Sélecteur d'aspect ratio */}
              <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />

              {/* Prompt */}
              <div className="mb-8">
                <label className="block text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wider">
                  Décris ton mytho
                </label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder={imagePreview2
                    ? 'Exemples (avec 2 photos) :\n• Mets cet homme sur cette plage\n• Place ce sac dans cette voiture\n• Fais apparaître ce chien dans ce salon'
                    : 'Exemples :\n• Mets-moi une Rolex sur le poignet\n• Ajoute un dinosaure dans le salon\n• Mets une moustache géante sur mon pote'
                  }
                  className="w-full h-36 rounded-2xl px-4 py-4 text-text-primary placeholder:text-text-secondary/40 text-sm leading-relaxed resize-none transition-all duration-200 focus:outline-none"
                  style={{
                    background: '#141826',
                    border: '1.5px solid rgba(198,255,60,0.15)',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(198,255,60,0.5)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(198,255,60,0.15)')}
                />
                <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                  💡 {imagePreview2
                    ? <>Mode 2 photos&nbsp;: <strong>Photo 1 = le sujet</strong>, <strong>Photo 2 = la scène</strong>. Décris simplement ce que tu veux. </>
                    : 'Astuce : sois précis dans ta description (couleur, position, style) pour un meilleur résultat. '}
                  Évite les noms de personnes réelles.
                </p>
              </div>

              {/* CTA */}
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="w-full py-5 text-lg font-black rounded-full bg-lime text-primary-bg active:scale-95 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ boxShadow: prompt.trim() ? '0 0 40px rgba(198,255,60,0.3)' : 'none' }}
              >
                Générer mon mytho ✨
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
