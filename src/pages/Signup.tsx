import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { supabase } from '@/lib/supabase'
import { fetchAccessProfile, hasPaidGoMythoAccess } from '@/lib/auth-access'

// ─── Page d'inscription PRÉ-paiement (version simplifiée) ───────────────
//
// Flux unique :
//   /choixoffre (clic « DÉBLOQUER MON MYTHO ») → /signup?plan=weekly|monthly
//     → 1. créer compte Supabase (ou Google OAuth)
//     → 2. redirect Stripe Payment Link avec client_reference_id=user.id
//     → 3. /paiementreussi → /makemytho

const PAYMENT_LINKS: Record<'weekly' | 'monthly', string> = {
  monthly: 'https://buy.stripe.com/fZu4gyauk4oy0rg8dVgYU00',
  weekly: 'https://buy.stripe.com/dRm6oGaukcV4c9Y1PxgYU01',
}

const PLAN_LABELS: Record<'weekly' | 'monthly', string> = {
  weekly: 'Hebdomadaire (2,99€)',
  monthly: 'Mensuel (9,90€)',
}

function buildPaymentLink(
  baseUrl: string,
  opts: { userId: string; email: string | null | undefined },
): string {
  const url = new URL(baseUrl)
  url.searchParams.set('client_reference_id', opts.userId)
  if (opts.email) url.searchParams.set('prefilled_email', opts.email)
  return url.toString()
}

function goToStripe(plan: 'weekly' | 'monthly', userId: string, userEmail: string | null) {
  try { localStorage.setItem('gomytho_pending_plan', plan) } catch { /* ignore */ }
  const link = buildPaymentLink(PAYMENT_LINKS[plan], { userId, email: userEmail })
  window.location.href = link
}

export default function Signup() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const planParam = searchParams.get('plan')
  const plan: 'weekly' | 'monthly' =
    planParam === 'weekly' || planParam === 'monthly' ? planParam : 'weekly'

  // Si l'utilisateur arrive ici déjà connecté :
  //   - s'il a un abo → /makemytho
  //   - sinon → on le bascule directement sur Stripe (pas besoin de
  //     re-créer un compte qui existe déjà).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled || !session) return
      const profile = await fetchAccessProfile(session.user.id)
      if (cancelled) return
      if (hasPaidGoMythoAccess(profile)) {
        window.location.replace('/makemytho')
      } else {
        goToStripe(plan, session.user.id, session.user.email ?? null)
      }
    })()
    return () => { cancelled = true }
  }, [plan])

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const { data, error: signUpErr } = await supabase.auth.signUp({ email, password })

      if (signUpErr) {
        if (/already registered|already exists|user.*exists/i.test(signUpErr.message)) {
          setError("Cet email a déjà un compte. Connecte-toi pour aller au paiement.")
          setIsLoading(false)
          return
        }
        throw signUpErr
      }

      if (!data.user) {
        setError('Création du compte impossible. Réessaie.')
        setIsLoading(false)
        return
      }

      // Si email confirmation activée côté Supabase, signUp ne retourne pas
      // de session → on tente d'ouvrir une session immédiatement.
      let session = data.session
      if (!session) {
        const { data: signInData } = await supabase.auth.signInWithPassword({ email, password })
        session = signInData?.session ?? null
      }

      if (!session) {
        setError('📧 Vérifie tes mails (et les spams) pour confirmer ton compte, puis recommence.')
        setIsLoading(false)
        return
      }

      // Anti-double paiement : si signUp a en fait reconnecté un compte
      // existant (Supabase peut le faire si email_confirmed = false), et
      // qu'il a déjà un abo, on évite le double paiement.
      const existing = await fetchAccessProfile(session.user.id)
      if (hasPaidGoMythoAccess(existing)) {
        window.location.replace('/makemytho')
        return
      }

      goToStripe(plan, session.user.id, session.user.email ?? email)
    } catch (e: unknown) {
      const err = e as { message?: string }
      setError(err.message || 'Une erreur est survenue.')
      setIsLoading(false)
    }
  }

  const handleGoogleSignup = async () => {
    setIsLoading(true)
    setError('')

    try {
      // Marqueur consommé par AuthCallback : indique que ce parcours OAuth
      // doit, après authentification réussie, rediriger vers Stripe avec
      // le plan choisi.
      try { sessionStorage.setItem('gomytho_signup_to_stripe_plan', plan) } catch { /* ignore */ }
      const origin = window.location.origin
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/auth/callback?signup_to_stripe=${plan}`,
        },
      })
      if (oauthErr) throw oauthErr
    } catch (e: unknown) {
      const err = e as { message?: string }
      setError(err.message || 'Connexion Google impossible.')
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
            className="text-center mb-8"
          >
            <h1 className="text-4xl md:text-5xl font-black mb-4">
              Crée ton compte
            </h1>
            <p className="text-text-secondary mb-3">
              Une étape rapide avant le paiement
            </p>
            <div className="inline-flex items-center gap-2 bg-lime/10 border border-lime/30 rounded-full px-4 py-1.5">
              <span className="text-lime text-sm font-semibold">
                Plan {PLAN_LABELS[plan]}
              </span>
            </div>
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
                  minLength={6}
                  className="w-full bg-primary-bg border-2 border-lime/20 rounded-2xl px-4 py-3 text-text-primary focus:border-lime focus:outline-none transition-all"
                  placeholder="••••••••"
                />
                <p className="text-xs text-text-secondary mt-2">
                  Minimum 6 caractères
                </p>
              </div>

              <Button type="submit" disabled={isLoading} size="lg" fullWidth>
                {isLoading ? 'Création du compte…' : 'Créer mon compte → Paiement'}
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
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continuer avec Google
            </Button>

            <p className="text-xs text-center text-text-secondary mt-6">
              Tu seras redirigé vers Stripe pour finaliser le paiement
              <br />
              <Link to="/login" className="text-lime hover:underline mt-2 inline-block font-semibold">
                Déjà un compte ? Se connecter
              </Link>
            </p>

            <p className="text-xs text-center text-text-secondary mt-6">
              En créant un compte, tu acceptes nos{' '}
              <a href="/terms" className="text-lime hover:underline">CGU</a>
              {' '}et notre{' '}
              <a href="/privacy" className="text-lime hover:underline">politique de confidentialité</a>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
