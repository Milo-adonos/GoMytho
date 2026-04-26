import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Button from '@/components/Button'
import { supabase, User } from '@/lib/supabase'
import { generateImage, uploadToStorage } from '@/lib/kie-api'

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'images' | 'videos'>('images')

  useEffect(() => {
    checkUser()
  }, [])

  const checkUser = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    
    if (!authUser) {
      navigate('/signup')
      return
    }

    // Récupérer les données utilisateur depuis la table users
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (error) {
      console.error('Error fetching user:', error)
      return
    }

    setUser(data)
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      setGeneratedImage(null)
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
      setGeneratedImage(null)
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const handleGenerate = async () => {
    if (!image || !prompt || !user) return

    if (user.credits_remaining < 8) {
      alert('Crédits insuffisants. Veuillez recharger.')
      return
    }

    setIsGenerating(true)
    try {
      // Générer l'image via Kie.ai
      const result = await generateImage({
        imageFile: image,
        prompt,
      })

      setGeneratedImage(result.imageUrl)

      // Upload vers Supabase Storage
      const publicUrl = await uploadToStorage(image, user.id)

      // Sauvegarder dans la base de données
      await supabase.from('mythos').insert([
        {
          user_id: user.id,
          image_url: publicUrl,
          prompt,
        },
      ])

      // Déduire les crédits
      await supabase
        .from('users')
        .update({ credits_remaining: user.credits_remaining - 8 })
        .eq('id', user.id)

      // Mettre à jour l'état local
      setUser({ ...user, credits_remaining: user.credits_remaining - 8 })
    } catch (error) {
      console.error('Error generating image:', error)
      alert('Erreur lors de la génération. Réessayez.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  const handleDownload = () => {
    if (!generatedImage) return
    const link = document.createElement('a')
    link.href = generatedImage
    link.download = `mytho-${Date.now()}.png`
    link.click()
  }

  const handleReset = () => {
    setImage(null)
    setImagePreview(null)
    setPrompt('')
    setGeneratedImage(null)
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-primary-bg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lime mx-auto mb-4" />
          <p className="text-text-secondary">Chargement...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-primary-bg">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-primary-bg/95 backdrop-blur-lg border-b border-lime/10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-black text-lime font-display">GoMytho</h1>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 bg-secondary-bg px-4 py-2 rounded-full border border-lime/20">
              <span className="text-lime">✨</span>
              <span className="font-semibold">{user.credits_remaining}</span>
              <span className="text-text-secondary text-sm">crédits</span>
            </div>
            
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="w-10 h-10 flex flex-col items-center justify-center gap-1.5 hover:opacity-70 transition-opacity"
            >
              <span className="w-6 h-0.5 bg-lime" />
              <span className="w-6 h-0.5 bg-lime" />
              <span className="w-6 h-0.5 bg-lime" />
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween' }}
              className="fixed top-0 right-0 bottom-0 w-80 bg-secondary-bg z-50 p-6 overflow-y-auto border-l border-lime/10"
            >
              <div className="mb-8">
                <p className="text-sm text-text-secondary mb-1">CONNECTÉ</p>
                <p className="font-semibold">{user.email}</p>
              </div>

              <nav className="space-y-2 mb-8">
                <button
                  onClick={() => {
                    setIsMenuOpen(false)
                    navigate('/app')
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary-bg transition-colors text-left"
                >
                  <span className="text-xl">🎨</span>
                  <span>Mes mythos</span>
                </button>
                <button
                  onClick={() => {
                    setIsMenuOpen(false)
                    navigate('/app/creations')
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary-bg transition-colors text-left"
                >
                  <span className="text-xl">📚</span>
                  <span>Historique</span>
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary-bg transition-colors text-left">
                  <span className="text-xl">✨</span>
                  <span>Crédits restants: {user.credits_remaining}</span>
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary-bg transition-colors text-left">
                  <span className="text-xl">💬</span>
                  <span>Support</span>
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-primary-bg transition-colors text-left">
                  <span className="text-xl">⚙️</span>
                  <span>Paramètres</span>
                </button>
              </nav>

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-500/10 transition-colors text-left text-red-400"
              >
                <span className="text-xl">🚪</span>
                <span>Déconnexion</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="pt-24 pb-12 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Tabs */}
          <div className="flex gap-2 mb-8">
            <button
              onClick={() => setActiveTab('images')}
              className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                activeTab === 'images'
                  ? 'bg-lime text-primary-bg'
                  : 'bg-secondary-bg text-text-secondary hover:text-text-primary'
              }`}
            >
              IMAGES
            </button>
            <button
              disabled
              className="px-6 py-3 rounded-xl font-semibold bg-secondary-bg text-text-secondary/50 cursor-not-allowed relative"
            >
              VIDÉOS
              <span className="absolute -top-2 -right-2 bg-lime text-primary-bg text-xs px-2 py-0.5 rounded-full font-bold">
                Bientôt
              </span>
            </button>
          </div>

          {/* Upload Zone */}
          {!imagePreview ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => document.getElementById('file-upload-dashboard')?.click()}
              className="border-2 border-dashed border-lime/30 rounded-3xl p-16 text-center hover:border-lime/50 transition-all cursor-pointer bg-secondary-bg/50 mb-8"
            >
              <div className="w-24 h-24 bg-lime/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border-2 border-lime/20">
                <span className="text-6xl">📷</span>
              </div>
              <h3 className="text-2xl font-bold mb-2">
                Clique pour sélectionner ton image
              </h3>
              <p className="text-text-secondary">
                ou glisse-dépose ton image ici
              </p>
              <input
                id="file-upload-dashboard"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-6 mb-8">
                {/* Image originale */}
                <div>
                  <p className="text-sm text-text-secondary mb-2 font-semibold">IMAGE ORIGINALE</p>
                  <div className="relative rounded-2xl overflow-hidden border-2 border-lime/20 bg-secondary-bg">
                    <img
                      src={imagePreview}
                      alt="Original"
                      className="w-full h-auto"
                    />
                  </div>
                </div>

                {/* Image générée */}
                <div>
                  <p className="text-sm text-text-secondary mb-2 font-semibold">RÉSULTAT</p>
                  <div className="relative rounded-2xl overflow-hidden border-2 border-lime/20 bg-secondary-bg aspect-square flex items-center justify-center">
                    {generatedImage ? (
                      <img
                        src={generatedImage}
                        alt="Generated"
                        className="w-full h-full object-cover"
                      />
                    ) : isGenerating ? (
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lime mx-auto mb-4" />
                        <p className="text-text-secondary">Génération en cours...</p>
                      </div>
                    ) : (
                      <div className="text-center p-8">
                        <span className="text-6xl mb-4 block">✨</span>
                        <p className="text-text-secondary">
                          Ton mytho apparaîtra ici
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Prompt Input */}
              <div className="mb-6">
                <label className="block text-sm font-semibold mb-2">
                  Décris ton mytho
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Décris ce que tu veux ajouter ou modifier..."
                  className="w-full h-32 bg-secondary-bg border-2 border-lime/20 rounded-2xl px-4 py-3 text-text-primary placeholder:text-text-secondary/50 focus:border-lime focus:outline-none focus:glow-lime transition-all resize-none"
                  disabled={isGenerating || !!generatedImage}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-4">
                {!generatedImage ? (
                  <>
                    <Button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || isGenerating || user.credits_remaining < 8}
                      size="lg"
                      className="flex-1"
                    >
                      {isGenerating ? 'Génération...' : `Générer ✨ 8 crédits`}
                    </Button>
                    <Button
                      onClick={handleReset}
                      variant="secondary"
                      size="lg"
                    >
                      Annuler
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={handleDownload} size="lg" className="flex-1">
                      Télécharger
                      <span className="text-xl">⬇️</span>
                    </Button>
                    <Button
                      onClick={() => {
                        setGeneratedImage(null)
                        setPrompt('')
                      }}
                      variant="secondary"
                      size="lg"
                    >
                      Refaire
                    </Button>
                    <Button onClick={handleReset} variant="secondary" size="lg">
                      Nouveau mytho
                    </Button>
                  </>
                )}
              </div>

              {user.credits_remaining < 8 && (
                <div className="mt-4 p-4 bg-orange-500/10 border border-orange-500/30 rounded-2xl text-center">
                  <p className="text-orange-400 font-semibold">
                    Crédits insuffisants. Rechargez pour continuer.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Add reference image button (optional) */}
          {imagePreview && !generatedImage && (
            <button className="w-full mt-6 p-4 border-2 border-dashed border-lime/20 rounded-2xl text-text-secondary hover:border-lime/40 hover:text-text-primary transition-all">
              <span className="text-2xl mr-2">+</span>
              AJOUTER IMAGE RÉFÉRENCE
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
