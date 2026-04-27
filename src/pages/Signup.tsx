import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { supabase } from '@/lib/supabase'
import { generateImage, uploadToSupabase } from '@/lib/kie-api'
import type { AspectRatio } from '@/lib/kie-api'

const PLAN_CONFIG = {
  weekly:  { credits: 160, label: 'hebdomadaire' },  // 20 images × 8 crédits
  monthly: { credits: 560, label: 'mensuel' },        // 70 images × 8 crédits
  free:    { credits: 3,   label: 'gratuit' },
}

export default function Signup() {
  const [searchParams] = useSearchParams()
  // Priorité : URL param > localStorage (sauvegardé avant le redirect Stripe)
  const urlPlan = searchParams.get('plan')
  const storedPlan = localStorage.getItem('gomytho_pending_plan')
  const rawPlan = (urlPlan || storedPlan || 'monthly') as keyof typeof PLAN_CONFIG
  const plan = PLAN_CONFIG[rawPlan] ? rawPlan : 'monthly'
  const { credits } = PLAN_CONFIG[plan]

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [genStep, setGenStep] = useState('')
  const [error, setError] = useState('')

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const { data: _data, error } = await supabase.auth.signUp({
        email,
        password,
      })

      if (error) throw error

      if (_data.user) {
        await supabase.from('users').upsert([{
          id: _data.user.id,
          email: _data.user.email,
          credits_remaining: credits,
          subscription_status: 'active',
          plan,
        }], { onConflict: 'id' })

        // Nettoyer le plan sauvegardé
        localStorage.removeItem('gomytho_pending_plan')

        // S'assurer d'avoir une session active
        let userId = _data.user.id
        if (!_data.session) {
          const { data: signInData } = await supabase.auth.signInWithPassword({ email, password })
          if (!signInData?.session) { window.location.href = '/login'; return }
          userId = signInData.session.user.id
        }

        // Générer automatiquement si une photo + prompt sont en attente
        const pendingImage = localStorage.getItem('gomytho_pending_image')
        const pendingPrompt = localStorage.getItem('gomytho_pending_prompt')
        const pendingRatio = (localStorage.getItem('gomytho_pending_ratio') || '9:16') as AspectRatio

        if (pendingImage && pendingPrompt) {
          setIsLoading(false)
          setIsGenerating(true)
          try {
            setGenStep('Conversion de ta photo...')
            const res = await fetch(pendingImage)
            const blob = await res.blob()
            const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })

            setGenStep('Upload de ta photo...')
            const publicUrl = await uploadToSupabase(file, userId)

            setGenStep('Génération de ton mytho...')
            const resultUrl = await generateImage(
              { userPrompt: pendingPrompt, imageUrl: publicUrl, aspectRatio: pendingRatio },
              (s) => setGenStep(s)
            )

            setGenStep('Sauvegarde...')
            await supabase.from('mythos').insert([{
              user_id: userId, image_url: resultUrl, prompt: pendingPrompt
            }])

            // Nettoyer
            localStorage.removeItem('gomytho_pending_image')
            localStorage.removeItem('gomytho_pending_prompt')
            localStorage.removeItem('gomytho_pending_ratio')
            window.location.href = '/resultats'
          } catch {
            // Génération échouée → aller sur /makemytho avec le prompt pré-rempli
            window.location.href = '/makemytho?pending=1'
          }
        } else {
          window.location.href = '/resultats'
        }
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      setError(err.message || 'Une erreur est survenue')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignup = async () => {
    setIsLoading(true)
    setError('')

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `https://gomytho.com/resultats?plan=${plan}`,
        },
      })

      if (error) throw error
    } catch (error: unknown) {
      const err = error as { message?: string }
      setError(err.message || 'Une erreur est survenue')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary-bg">
      {/* Écran de génération automatique */}
      {isGenerating && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
          style={{ background: '#0A0E1A' }}>
          <div className="text-center max-w-sm">
            <div className="w-20 h-20 rounded-full border-4 border-lime/20 border-t-lime animate-spin mx-auto mb-6" />
            <h2 className="text-2xl font-black text-white mb-2">Génération en cours...</h2>
            <p className="text-lime font-semibold text-sm mb-2">{genStep}</p>
            <p className="text-text-secondary text-xs">Ça prend ~15 secondes, ne ferme pas cette page</p>
            <div className="mt-6 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(198,255,60,0.1)' }}>
              <div className="h-full bg-lime animate-pulse rounded-full w-full" />
            </div>
          </div>
        </div>
      )}
      <Header showLogin={false} />

      <div className="pt-32 pb-20 px-4">
        <div className="max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-5xl font-black mb-4">
              Crée ton compte
            </h1>
            <p className="text-text-secondary mb-3">
              Pour accéder à tes mythos depuis n'importe où
            </p>
            {searchParams.get('plan') && (
              <div className="inline-flex items-center gap-2 bg-lime/10 border border-lime/30 rounded-full px-4 py-1.5">
                <span className="w-2 h-2 rounded-full bg-lime animate-pulse" />
                <span className="text-lime text-sm font-semibold">
                  Plan {PLAN_CONFIG[plan].label} — {credits} mythos
                </span>
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-secondary-bg rounded-3xl p-8 border border-lime/10"
          >
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleEmailSignup} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-semibold mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-primary-bg border-2 border-lime/20 rounded-2xl px-4 py-3 text-text-primary focus:border-lime focus:outline-none focus:glow-lime transition-all"
                  placeholder="ton@email.fr"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold mb-2">
                  Mot de passe
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full bg-primary-bg border-2 border-lime/20 rounded-2xl px-4 py-3 text-text-primary focus:border-lime focus:outline-none focus:glow-lime transition-all"
                  placeholder="••••••••"
                />
                <p className="text-xs text-text-secondary mt-2">
                  Minimum 6 caractères
                </p>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                size="lg"
                fullWidth
              >
                {isLoading ? 'Création...' : 'Créer mon compte'}
              </Button>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-lime/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-secondary-bg text-text-secondary">
                  ou
                </span>
              </div>
            </div>

            <Button
              onClick={handleGoogleSignup}
              disabled={isLoading}
              variant="secondary"
              size="lg"
              fullWidth
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continuer avec Google
            </Button>

            <p className="text-xs text-center text-text-secondary mt-6">
              En créant un compte, tu acceptes nos{' '}
              <a href="/terms" className="text-lime hover:underline">
                CGU
              </a>{' '}
              et notre{' '}
              <a href="/privacy" className="text-lime hover:underline">
                politique de confidentialité
              </a>
            </p>
          </motion.div>

        </div>
      </div>
    </div>
  )
}
