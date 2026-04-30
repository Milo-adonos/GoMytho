import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { hasPaidGoMythoAccess, resolveAccessProfile } from '@/lib/auth-access'
import Header from '@/components/Header'
import Button from '@/components/Button'

async function waitForSession(maxAttempts = 12, delayMs = 250) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const { data } = await supabase.auth.getSession()
    if (data?.session) return data.session
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

export default function Login() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (searchParams.get('reason') === 'no_access') {
      setError(
        "❌ Ce compte n'a pas d'abonnement GoMytho actif. Tu dois d'abord souscrire depuis la page d'offre — la connexion Google ou email seule ne crée pas d'accès payant.",
      )
    }
  }, [searchParams])
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        if (error.message?.includes('Invalid login credentials')) {
          setError('❌ Email ou mot de passe incorrect. Pas encore de compte ? Commence par payer ton abonnement.')
        } else if (error.message?.includes('Email not confirmed')) {
          // Email non confirmé → on tente quand même de récupérer la session
          const { data: { session } } = await supabase.auth.getSession()
          if (session) { window.location.href = '/makemytho'; return }
          setError('❌ Confirme ton email avant de te connecter.')
        } else {
          setError(error.message || 'Une erreur est survenue')
        }
        return
      }

      // Connexion réussie → attendre que la session soit réellement persistée
      const session = await waitForSession()
      if (!session) {
        setError('Connexion réussie, mais session non détectée. Réessaie une fois.')
        return
      }

      // Lookup avec fallback par email (utile si l'utilisateur a payé sous
      // une autre méthode d'auth) — voir resolveAccessProfile pour le détail.
      const profile = await resolveAccessProfile(session.user.id, session.user.email)

      if (!hasPaidGoMythoAccess(profile)) {
        try {
          const { resetAnalytics } = await import('@/lib/analytics')
          resetAnalytics()
        } catch { /* ignore */ }
        await supabase.auth.signOut()
        setError(
          "❌ Aucun abonnement associé à ce compte. Commence par choisir une offre et finalise le paiement sur Stripe pour créer ton accès.",
        )
        return
      }

      window.location.href = '/makemytho'
    } catch {
      setError('Une erreur est survenue. Réessaie.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setIsLoading(true)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // /auth/callback est le SEUL redirect URL à inscrire en allowlist
          // côté Supabase Dashboard. Cette page attend que la session soit
          // bien établie avant de naviguer vers /resultats — sans ça, le
          // hash #access_token=... est perdu et le user est jeté.
          redirectTo: `${window.location.origin}/auth/callback`,
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
      <Header showLogin={false} />

      <div className="pt-32 pb-20 px-4">
        <div className="max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-5xl font-black mb-4">
              Connexion
            </h1>
            <p className="text-text-secondary">
              Content de te revoir 👋
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-secondary-bg rounded-3xl p-8 border border-lime/10"
          >
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-sm space-y-2">
                <p className="text-red-400">{error}</p>
                {error.includes('incorrect') && (
                  <a
                    href="/uploadphoto"
                    className="block text-center mt-2 text-lime font-semibold hover:underline"
                  >
                    → Essayer GoMytho gratuitement
                  </a>
                )}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-6">
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
                  className="w-full bg-primary-bg border-2 border-lime/20 rounded-2xl px-4 py-3 text-text-primary focus:border-lime focus:outline-none transition-all"
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
                  className="w-full bg-primary-bg border-2 border-lime/20 rounded-2xl px-4 py-3 text-text-primary focus:border-lime focus:outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                size="lg"
                fullWidth
              >
                {isLoading ? 'Connexion...' : 'Se connecter'}
              </Button>
            </form>

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-lime/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-secondary-bg text-text-secondary">ou</span>
              </div>
            </div>

            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 bg-primary-bg border-2 border-lime/20 rounded-2xl px-4 py-3 text-text-primary font-semibold hover:border-lime/50 transition-all"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continuer avec Google
            </button>

            <p className="text-center text-sm text-text-secondary mt-8">
              Pas encore de compte ?{' '}
              <Link to="/signup" className="text-lime hover:underline font-semibold">
                Créer un compte
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
