import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '@/components/Header'
import AspectRatioSelector from '@/components/AspectRatioSelector'
import { AspectRatio } from '@/lib/kie-api'
import { convertToJpeg } from '@/lib/image-utils'

export default function Create() {
  const navigate = useNavigate()
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16')
  const [isConverting, setIsConverting] = useState(false)

  const handleFile = async (file: File) => {
    setIsConverting(true)
    try {
      const { file: jpeg, preview } = await convertToJpeg(file)
      setImage(jpeg)
      setImagePreview(preview)
    } finally {
      setIsConverting(false)
    }
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

          {/* Zone d'upload */}
          {!imagePreview ? (
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => !isConverting && document.getElementById('file-upload')?.click()}
              className="border-2 border-dashed rounded-3xl p-12 text-center active:scale-95 transition-all duration-200 cursor-pointer mb-8"
              style={{ borderColor: 'rgba(198,255,60,0.3)', background: 'rgba(20,24,38,0.5)' }}
            >
              {isConverting ? (
                <>
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lime mx-auto mb-3" />
                  <p className="text-lime font-bold">Traitement de la photo...</p>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5"
                    style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.2)' }}>
                    <span className="text-4xl">📷</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Clique pour sélectionner ta photo</h3>
                  <p className="text-text-secondary text-sm">Galerie, caméra — tous formats acceptés</p>
                </>
              )}
              <input
                id="file-upload"
                type="file"
                accept="image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp"
                onChange={async e => { if (e.target.files?.[0]) await handleFile(e.target.files[0]) }}
                className="hidden"
              />
            </div>
          ) : (
            <div className="relative rounded-3xl overflow-hidden border mb-8" style={{ borderColor: 'rgba(198,255,60,0.3)' }}>
              <img src={imagePreview} alt="Preview" className="w-full h-auto max-h-72 object-cover" />
              <button
                onClick={() => { setImage(null); setImagePreview(null) }}
                className="absolute top-3 right-3 bg-primary-bg/90 text-lime text-sm font-bold px-4 py-2 rounded-full active:scale-95 transition-all"
                style={{ border: '1px solid rgba(198,255,60,0.3)' }}
              >
                Changer
              </button>
            </div>
          )}

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
                  placeholder={'Exemples :\n• Mets-moi une Rolex sur le poignet\n• Ajoute un dinosaure dans le salon\n• Mets une moustache géante sur mon pote'}
                  className="w-full h-36 rounded-2xl px-4 py-4 text-text-primary placeholder:text-text-secondary/40 text-sm leading-relaxed resize-none transition-all duration-200 focus:outline-none"
                  style={{
                    background: '#141826',
                    border: '1.5px solid rgba(198,255,60,0.15)',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(198,255,60,0.5)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(198,255,60,0.15)')}
                />
                <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                  💡 Astuce : sois précis dans ta description (couleur, position, style) pour un meilleur résultat. Évite les noms de personnes réelles.
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
