import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Button from '@/components/Button'
import { supabase, Mytho, User } from '@/lib/supabase'

export default function Creations() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [mythos, setMythos] = useState<Mytho[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    checkUser()
  }, [])

  const checkUser = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    
    if (!authUser) {
      navigate('/signup')
      return
    }

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()

    setUser(userData)

    // Récupérer tous les mythos de l'utilisateur
    const { data: mythosData, error } = await supabase
      .from('mythos')
      .select('*')
      .eq('user_id', authUser.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching mythos:', error)
    } else {
      setMythos(mythosData || [])
    }

    setIsLoading(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce mytho ?')) return

    const { error } = await supabase
      .from('mythos')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting mytho:', error)
      alert('Erreur lors de la suppression')
    } else {
      setMythos(mythos.filter(m => m.id !== id))
    }
  }

  const handleDownload = (imageUrl: string) => {
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `mytho-${Date.now()}.png`
    link.click()
  }

  if (isLoading) {
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
          <button
            onClick={() => navigate('/app')}
            className="flex items-center gap-2 hover:opacity-70 transition-opacity"
          >
            <span className="text-xl">←</span>
            <h1 className="text-2xl font-black text-lime font-display">GoMytho</h1>
          </button>
          
          {user && (
            <div className="flex items-center gap-2 bg-secondary-bg px-4 py-2 rounded-full border border-lime/20">
              <span className="text-lime">✨</span>
              <span className="font-semibold">{user.credits_remaining}</span>
              <span className="text-text-secondary text-sm">crédits</span>
            </div>
          )}
        </div>
      </header>

      <div className="pt-24 pb-12 px-4">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Mes créations
            </h2>
            <p className="text-xl text-text-secondary">
              {mythos.length} {mythos.length > 1 ? 'mythos créés' : 'mytho créé'}
            </p>
          </motion.div>

          {mythos.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-20"
            >
              <div className="w-32 h-32 bg-secondary-bg rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-7xl">🎨</span>
              </div>
              <h3 className="text-2xl font-bold mb-4">
                Aucun mytho pour le moment
              </h3>
              <p className="text-text-secondary mb-8">
                Crée ton premier mytho maintenant
              </p>
              <Button onClick={() => navigate('/app')} size="lg">
                Créer un mytho
                <span className="text-2xl">→</span>
              </Button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {mythos.map((mytho, index) => (
                <motion.div
                  key={mytho.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="group relative bg-secondary-bg rounded-2xl overflow-hidden border border-lime/10 hover:border-lime/30 transition-all"
                >
                  <div className="aspect-square bg-primary-bg relative overflow-hidden">
                    <img
                      src={mytho.image_url}
                      alt={mytho.prompt}
                      className="w-full h-full object-cover"
                    />
                    
                    {/* Overlay on hover */}
                    <div className="absolute inset-0 bg-primary-bg/90 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3 p-4">
                      <button
                        onClick={() => handleDownload(mytho.image_url)}
                        className="w-full bg-lime text-primary-bg px-4 py-2 rounded-xl font-semibold hover:bg-lime-hover transition-colors"
                      >
                        Télécharger
                      </button>
                      <button
                        onClick={() => handleDelete(mytho.id)}
                        className="w-full bg-red-500/20 text-red-400 px-4 py-2 rounded-xl font-semibold hover:bg-red-500/30 transition-colors"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>

                  <div className="p-4">
                    <p className="text-sm text-text-secondary line-clamp-2 mb-2">
                      {mytho.prompt}
                    </p>
                    <p className="text-xs text-text-secondary/50">
                      {new Date(mytho.created_at).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
