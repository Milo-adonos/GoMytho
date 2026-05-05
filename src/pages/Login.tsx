import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import Header from '@/components/Header'
import Button from '@/components/Button'
import {
  clearPendingStripeSessionId,
  fetchAccessProfile,
  hasPaidGoMythoAccess,
  resolvePaidAccessViaStripe,
  shouldBypassAccessCheck,
  NO_SUBSCRIPTION_FLAG_KEY,
} from '@/lib/auth-access'

// ─── Page Connexion ───────────────────────────────────────────────────────
//
// Règle d'accès : un compte authentifié n'a accès à l'app que si la DB
// confirme un abonnement payant ou des crédits restants. Sans cette
// vérification, Google OAuth créait des comptes Supabase pour n'importe
// quel email Google → accès gratuit à l'app. Faille corrigée le 2026-05-02.

const NO_SUB_MSG =
  "Ce compte n'a pas d'abonnement actif. Choisis une offre pour commencer."

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Si un flag d'erreur a été posé par AuthCallback (Google OAuth refusé
  // faute d'abonnement), on l'affiche ici puis on le purge.
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem(NO_SUBSCRIPTION_FLAG_KEY)
      if (msg) {
        setError(msg)
        sessionStorage.removeItem(NO_SUBSCRIPTION_FLAG_KEY)
      }
    } catch { /* ignore */ }
  }, [])

  const goToApp = () => {
    window.location.href = '/makemytho'
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) {
        if (/Invalid login credentials/i.test(signInErr.message)) {
          setError('Email ou mot de passe incorrect.')
        } else {
          setError(signInErr.message || 'Connexion impossible.')
        }
        return
      }
      if (!data.session) {
        setError('Session non détectée. Réessaie.')
        return
      }

      // ─── Vérification accès payant ──────────────────────────────────────
      // On laisse passer un user qui revient tout juste de Stripe (le
      // webhook peut être en retard). Sinon on contrôle dans la DB.
      if (!shouldBypassAccessCheck()) {
        const profile = await fetchAccessProfile(data.session.user.id)
        if (!hasPaidGoMythoAccess(profile)) {
          // Filet de sécurité : la DB ne montre pas d'abonnement, mais
          // Stripe peut être la vraie source de vérité (webhook perdu,
          // email du paiement différent de l'email du compte, race
          // condition au signup, …). resolvePaidAccessViaStripe utilise
          // automatiquement un éventuel `gomytho_pending_session_id` posé
          // par /paiementreussi : c'est ce session_id qui permet de lier
          // un Customer Stripe (Apple Pay / Google Pay / Revolut Pay /
          // alias) à un user Supabase MÊME quand les emails diffèrent.
          const access = await resolvePaidAccessViaStripe(data.session.access_token)
          if (!access.ok) {
            await supabase.auth.signOut()
            setError(NO_SUB_MSG)
            return
          }
        } else {
          // DB déjà cohérente → un éventuel session_id pending n'est plus
          // utile, on purge pour éviter qu'il pollue une future session.
          clearPendingStripeSessionId()
        }
      }

      goToApp()
    } catch (err) {
      const e = err as { message?: string }
      setError(e.message || 'Une erreur est survenue. Réessaie.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setIsLoading(true)
    setError('')
    try {
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (oauthErr) throw oauthErr
    } catch (err) {
      const e = err as { message?: string }
      setError(e.message || 'Connexion Google impossible.')
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
            <h1 className="text-4xl md:text-5xl font-black mb-4">Connexion</h1>
            <p className="text-text-secondary">Content de te revoir 👋</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-secondary-bg rounded-3xl p-8 border border-lime/10"
          >
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-sm">
                <p className="text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleEmailLogin} className="space-y-6">
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

              <Button type="submit" disabled={isLoading} size="lg" fullWidth>
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
              <Link to="/choixoffre" className="text-lime hover:underline font-semibold">
                Choisir une offre
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
