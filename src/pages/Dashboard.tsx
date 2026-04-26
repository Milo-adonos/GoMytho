import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase, User } from '@/lib/supabase'
import { generateImage, uploadToSupabase, AspectRatio } from '@/lib/kie-api'
import AspectRatioSelector from '@/components/AspectRatioSelector'

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingStep, setGeneratingStep] = useState('')
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [activeTab] = useState<'images' | 'videos'>('images')

  useEffect(() => { checkUser() }, [])

  const checkUser = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { navigate('/signup'); return }
    const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
    if (data) setUser(data)
  }

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    setImage(file)
    const reader = new FileReader()
    reader.onloadend = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(file)
    setGeneratedImage(null)
  }

  const handleGenerate = async () => {
    if (!image || !prompt || !user) return
    if (user.credits_remaining < 8) { alert('Crédits insuffisants.'); return }

    setIsGenerating(true)
    setGeneratedImage(null)
    try {
      // 1. Upload vers Supabase Storage pour obtenir une URL publique
      setGeneratingStep('Upload de ta photo...')
      const publicImageUrl = await uploadToSupabase(image, user.id)

      // 2. Appel API Kie.ai avec les paramètres verrouillés
      const resultUrl = await generateImage(
        { userPrompt: prompt, imageUrl: publicImageUrl, aspectRatio },
        (step) => setGeneratingStep(step)
      )

      setGeneratedImage(resultUrl)

      // 3. Sauvegarder le mytho en base
      await supabase.from('mythos').insert([{ user_id: user.id, image_url: resultUrl, prompt }])

      // 4. Déduire les crédits
      const newCredits = user.credits_remaining - 8
      await supabase.from('users').update({ credits_remaining: newCredits }).eq('id', user.id)
      setUser({ ...user, credits_remaining: newCredits })

    } catch (err) {
      console.error(err)
      alert('Erreur lors de la génération. Réessaye.')
    } finally {
      setIsGenerating(false)
      setGeneratingStep('')
    }
  }

  const handleDownload = () => {
    if (!generatedImage) return
    const a = document.createElement('a')
    a.href = generatedImage
    a.download = `gomytho-${Date.now()}.jpg`
    a.click()
  }

  const handleReset = () => { setImage(null); setImagePreview(null); setPrompt(''); setGeneratedImage(null) }

  if (!user) {
    return (
      <div className="min-h-screen bg-primary-bg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lime mx-auto mb-3" />
          <p className="text-text-secondary text-sm">Chargement...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-primary-bg">

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-primary-bg/95 backdrop-blur-lg" style={{ borderBottom: '1px solid rgba(198,255,60,0.08)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <span className="text-2xl font-black text-lime" style={{ textShadow: '0 0 15px rgba(198,255,60,0.3)' }}>GoMytho</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold" style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.2)' }}>
              <span className="text-lime">✨</span>
              <span>{user.credits_remaining}</span>
            </div>
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="flex flex-col gap-1.5 p-2">
              <span className="w-5 h-0.5 bg-lime block" />
              <span className="w-5 h-0.5 bg-lime block" />
              <span className="w-5 h-0.5 bg-lime block" />
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed top-0 right-0 bottom-0 w-72 z-50 flex flex-col p-6"
              style={{ background: '#141826', borderLeft: '1px solid rgba(198,255,60,0.1)' }}>
              <div className="mb-8">
                <p className="text-xs text-text-secondary mb-1 uppercase tracking-wider">Connecté</p>
                <p className="font-semibold text-sm truncate">{user.email}</p>
              </div>
              <nav className="flex flex-col gap-1 flex-1">
                {[
                  { icon: '🎨', label: 'Créer', action: () => { setIsMenuOpen(false) } },
                  { icon: '📚', label: 'Mes mythos', action: () => { navigate('/app/creations'); setIsMenuOpen(false) } },
                  { icon: '✨', label: `${user.credits_remaining} crédits`, action: () => {} },
                  { icon: '💬', label: 'Support', action: () => {} },
                  { icon: '⚙️', label: 'Paramètres', action: () => {} },
                ].map((item, i) => (
                  <button key={i} onClick={item.action}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm transition-colors hover:bg-primary-bg active:bg-primary-bg">
                    <span>{item.icon}</span><span>{item.label}</span>
                  </button>
                ))}
              </nav>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/') }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                <span>🚪</span><span>Déconnexion</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Contenu principal */}
      <div className="pt-20 pb-16 px-4">
        <div className="max-w-2xl mx-auto">

          {/* Tabs */}
          <div className="flex gap-2 mb-8 mt-4">
            <div className="px-5 py-2.5 rounded-xl text-sm font-black text-primary-bg" style={{ background: '#C6FF3C' }}>
              IMAGES
            </div>
            <div className="relative px-5 py-2.5 rounded-xl text-sm font-bold text-text-secondary" style={{ background: '#141826' }}>
              VIDÉOS
              <span className="absolute -top-2 -right-2 bg-lime text-primary-bg text-[9px] font-black px-1.5 py-0.5 rounded-full">BIENTÔT</span>
            </div>
          </div>

          {activeTab === 'images' && (
            <>
              {/* Zone upload */}
              {!imagePreview ? (
                <div
                  onClick={() => document.getElementById('dash-upload')?.click()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                  onDragOver={e => e.preventDefault()}
                  className="border-2 border-dashed rounded-3xl p-14 text-center cursor-pointer active:scale-95 transition-all duration-200 mb-8"
                  style={{ borderColor: 'rgba(198,255,60,0.25)', background: 'rgba(20,24,38,0.5)' }}
                >
                  <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
                    style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.2)' }}>
                    <span className="text-4xl">📷</span>
                  </div>
                  <h3 className="text-xl font-bold mb-1">Clique pour sélectionner ton image</h3>
                  <p className="text-text-secondary text-sm">ou glisse-dépose ici</p>
                  <input id="dash-upload" type="file" accept="image/*" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} className="hidden" />
                </div>
              ) : (
                <>
                  {/* Aperçu avant/après */}
                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div>
                      <p className="text-xs text-text-secondary font-bold mb-2 uppercase tracking-wider">Original</p>
                      <div className="rounded-2xl overflow-hidden aspect-square" style={{ border: '1px solid rgba(198,255,60,0.15)' }}>
                        <img src={imagePreview} alt="Original" className="w-full h-full object-cover" />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: isGenerating ? '#C6FF3C' : 'rgba(138,143,160,1)' }}>
                        {isGenerating ? generatingStep || 'Génération...' : 'Résultat'}
                      </p>
                      <div className="rounded-2xl overflow-hidden aspect-square flex items-center justify-center" style={{ border: `1px solid ${isGenerating ? 'rgba(198,255,60,0.4)' : 'rgba(198,255,60,0.15)'}`, background: '#141826' }}>
                        {generatedImage ? (
                          <img src={generatedImage} alt="Résultat" className="w-full h-full object-cover" />
                        ) : isGenerating ? (
                          <div className="text-center p-4">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime mx-auto mb-2" />
                            <p className="text-xs text-lime">{generatingStep}</p>
                          </div>
                        ) : (
                          <div className="text-center p-4">
                            <span className="text-4xl block mb-2">✨</span>
                            <p className="text-xs text-text-secondary">Ton mytho ici</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Sélecteur ratio */}
                  <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />

                  {/* Prompt */}
                  <div className="mb-6">
                    <label className="block text-xs font-bold text-text-secondary mb-3 uppercase tracking-wider">
                      Décris ton mytho
                    </label>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder="Ex: Mets-moi une Rolex sur le poignet..."
                      disabled={isGenerating || !!generatedImage}
                      className="w-full h-28 rounded-2xl px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/40 resize-none focus:outline-none transition-all"
                      style={{ background: '#141826', border: '1.5px solid rgba(198,255,60,0.15)' }}
                      onFocus={e => (e.target.style.borderColor = 'rgba(198,255,60,0.5)')}
                      onBlur={e => (e.target.style.borderColor = 'rgba(198,255,60,0.15)')}
                    />
                    <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                      💡 Astuce : sois précis dans ta description (couleur, position, style) pour un meilleur résultat. Évite les noms de personnes réelles.
                    </p>
                  </div>

                  {/* Actions */}
                  {!generatedImage ? (
                    <div className="flex gap-3">
                      <button
                        onClick={handleGenerate}
                        disabled={!prompt.trim() || isGenerating || user.credits_remaining < 8}
                        className="flex-1 py-4 text-base font-black rounded-full bg-lime text-primary-bg active:scale-95 transition-all disabled:opacity-40"
                        style={{ boxShadow: '0 0 30px rgba(198,255,60,0.2)' }}
                      >
                        {isGenerating ? 'Génération...' : 'Générer ✨ 8 crédits'}
                      </button>
                      <button onClick={handleReset}
                        className="px-5 py-4 rounded-full font-bold text-sm active:scale-95 transition-all"
                        style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)' }}>
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button onClick={handleDownload}
                        className="flex-1 py-4 text-base font-black rounded-full bg-lime text-primary-bg active:scale-95 transition-all"
                        style={{ boxShadow: '0 0 30px rgba(198,255,60,0.2)' }}>
                        Télécharger ⬇️
                      </button>
                      <button onClick={() => { setGeneratedImage(null); setPrompt('') }}
                        className="px-5 py-4 rounded-full font-bold text-sm active:scale-95 transition-all"
                        style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)' }}>
                        Refaire
                      </button>
                      <button onClick={handleReset}
                        className="px-5 py-4 rounded-full font-bold text-sm active:scale-95 transition-all"
                        style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.2)' }}>
                        Nouveau
                      </button>
                    </div>
                  )}

                  {user.credits_remaining < 8 && (
                    <div className="mt-4 p-4 rounded-2xl text-center text-sm text-orange-400 font-semibold"
                      style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}>
                      Crédits insuffisants — Rechargez pour continuer
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
