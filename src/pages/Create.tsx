import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'

export default function Create() {
  const navigate = useNavigate()
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      setImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const handleGenerate = () => {
    if (image && prompt) {
      // Stocker l'image et le prompt dans sessionStorage pour la page analyzing
      sessionStorage.setItem('uploadedImage', imagePreview!)
      sessionStorage.setItem('userPrompt', prompt)
      navigate('/analyzing')
    }
  }

  return (
    <div className="min-h-screen bg-primary-bg">
      <Header showLogin={false} />

      <div className="pt-32 pb-20 px-4">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-6xl font-black mb-4">
              Upload ta photo
            </h1>
            <p className="text-xl text-text-secondary">
              Plus elle est nette, plus le résultat sera bluffant
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            {!imagePreview ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="border-2 border-dashed border-lime/30 rounded-3xl p-12 text-center hover:border-lime/50 transition-all cursor-pointer bg-secondary-bg/50"
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                <div className="w-24 h-24 bg-lime/10 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-lime/20">
                  <span className="text-6xl">📷</span>
                </div>
                <h3 className="text-2xl font-bold mb-2">
                  Clique pour sélectionner ta photo
                </h3>
                <p className="text-text-secondary">
                  ou glisse-dépose ton image ici
                </p>
                <input
                  id="file-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
            ) : (
              <div className="relative rounded-3xl overflow-hidden border-2 border-lime/30">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="w-full h-auto max-h-96 object-contain bg-secondary-bg"
                />
                <button
                  onClick={() => {
                    setImage(null)
                    setImagePreview(null)
                  }}
                  className="absolute top-4 right-4 bg-primary-bg/90 text-lime px-4 py-2 rounded-full font-semibold hover:bg-lime hover:text-primary-bg transition-all"
                >
                  Changer
                </button>
              </div>
            )}
          </motion.div>

          {imagePreview && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8"
            >
              <label className="block text-xl font-bold mb-4">
                Décris ton mytho
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Décris ce que tu veux ajouter ou modifier...
Exemples :
- Mets-moi une Rolex sur le poignet
- Ajoute un poisson absurde
- Mets une moustache géante"
                className="w-full h-40 bg-secondary-bg border-2 border-lime/20 rounded-2xl px-6 py-4 text-text-primary placeholder:text-text-secondary/50 focus:border-lime focus:outline-none focus:glow-lime transition-all resize-none"
              />
            </motion.div>
          )}

          {imagePreview && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                size="lg"
                fullWidth
              >
                Générer mon mytho
                <span className="text-2xl">✨</span>
              </Button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
