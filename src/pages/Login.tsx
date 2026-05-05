import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import Header from '@/components/Header'
import Button from '@/components/Button'
import {
  claimSubscriptionByPaymentEmail,
  fetchAccessProfile,
  hasPaidGoMythoAccess,
  shouldBypassAccessCheck,
  NO_SUBSCRIPTION_FLAG_KEY,
} from '@/lib/auth-access'

// ─── Page Connexion ──────────────────────────────────────────────────────
//
// Avec le nouveau flux (inscription AVANT paiement + client_reference_id),
// le webhook Stripe lie TOUJOURS le Customer par user.id Supabase. Donc
// au login on a juste à :
//   1) signInWithPassword
//   2) Lire la DB → vérifier qu'il y a un abo
//   3) Si oui → /makemytho
//   4) Si non → on garde le compte mais on le redirige vers /choixoffre
//      (il pourra reprendre son abo, son user.id sera réutilisé pour la
//      liaison Stripe).
//
// Plus de fallback complexe (resolve-by-stripe, claim-by-email, etc.) :
// la DB est la source de vérité, et le webhook s'occupe du reste.

const NO_SUB_MSG =
  "Ce compte n'a pas d'abonnement actif. Choisis une offre pour commencer."

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // ─── État pour le flux « Récupérer mon abonnement » ────────────────────
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimEmail, setClaimEmail] = useState('')
  const [claimPwd, setClaimPwd] = useState('')
  const [claimStripeEmail, setClaimStripeEmail] = useState('')
  const [claimLoading, setClaimLoading] = useState(false)
  const [claimError, setClaimError] = useState('')
  const [claimSuccess, setClaimSuccess] = useState('')

  // Si un flag d'erreur a été posé par AuthCallback (Google OAuth refusé
  // faute d'abonnement) ou par AppLayout (session sans abo détectée), on
  // l'affiche ici puis on le purge.
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
          // Pas d'abo en DB → on déconnecte pour que /choixoffre ne croie
          // pas qu'on a déjà payé. L'utilisateur peut alors reprendre son
          // parcours d'inscription/paiement avec son MÊME compte.
          await supabase.auth.signOut()
          setError(NO_SUB_MSG)
          return
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

  // ─── Récupération d'abonnement (anciens clients pré-refonte) ─────────
  // Le user fournit :
  //  - L'email/password de SON COMPTE Supabase (qu'il vient de créer ou
  //    qu'il avait déjà) → on l'authentifie
  //  - L'email avec lequel il a payé sur Stripe (peut être différent)
  // Le serveur vérifie qu'il y a bien un abo actif sur Stripe pour cet
  // email, puis lie le tout à son compte courant.
  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setClaimLoading(true)
    setClaimError('')
    setClaimSuccess('')
    try {
      // 1. Essayer de se connecter avec les identifiants fournis ; si le
      //    compte n'existe pas, on le crée à la volée.
      let session: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data']['session'] = null

      const { data: signInData, error: signInErr } =
        await supabase.auth.signInWithPassword({ email: claimEmail, password: claimPwd })
      if (signInData?.session) {
        session = signInData.session
      } else {
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: claimEmail,
          password: claimPwd,
        })
        if (signUpErr) {
          if (/Invalid login credentials/i.test(signInErr?.message || '')) {
            setClaimError('Email ou mot de passe incorrect.')
          } else {
            setClaimError(signUpErr.message || 'Création/connexion du compte impossible.')
          }
          return
        }
        if (signUpData.session) {
          session = signUpData.session
        } else {
          // Email confirmation activée : tente un signIn pour récupérer la session.
          const retry = await supabase.auth.signInWithPassword({
            email: claimEmail,
            password: claimPwd,
          })
          session = retry.data?.session ?? null
          if (!session) {
            setClaimError('📧 Vérifie tes mails (et les spams) pour confirmer ton compte, puis recommence.')
            return
          }
        }
      }

      if (!session) {
        setClaimError('Connexion impossible. Réessaie.')
        return
      }

      // 2. Lance le claim côté serveur
      const result = await claimSubscriptionByPaymentEmail(session.access_token, claimStripeEmail)
      if (!result.ok) {
        setClaimError(result.error)
        return
      }

      setClaimSuccess('Abonnement récupéré ! Redirection vers ton app…')
      setTimeout(() => {
        window.location.href = '/makemytho'
      }, 1000)
    } catch (e) {
      const err = e as { message?: string }
      setClaimError(err.message || 'Une erreur est survenue.')
    } finally {
      setClaimLoading(false)
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

          {/* ─── Récupération d'abonnement (anciens clients) ─────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-6 bg-secondary-bg/60 rounded-3xl border border-lime/10 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setClaimOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-lime/5 transition-colors"
            >
              <span className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-lime/15 border border-lime/30 flex items-center justify-center text-lime text-sm font-black">
                  ?
                </span>
                <span>
                  <span className="block font-bold text-text-primary">
                    J'ai payé mais je n'arrive pas à accéder à mon compte
                  </span>
                  <span className="block text-xs text-text-secondary mt-0.5">
                    Récupérer mon abonnement avec mon email Stripe
                  </span>
                </span>
              </span>
              <span className={`text-lime text-lg transition-transform ${claimOpen ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>

            <AnimatePresence initial={false}>
              {claimOpen && (
                <motion.div
                  key="claim-form"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-6 pt-2">
                    {claimError && (
                      <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                        {claimError}
                      </div>
                    )}
                    {claimSuccess && (
                      <div className="mb-4 p-3 bg-lime/10 border border-lime/30 rounded-xl text-lime text-sm font-semibold">
                        ✓ {claimSuccess}
                      </div>
                    )}

                    <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                      Si tu as payé sur Stripe avant la mise à jour, ton paiement
                      est bien enregistré. Crée (ou connecte-toi à) un compte
                      ci-dessous, et indique l'email avec lequel tu as payé sur
                      Stripe — on relie le tout automatiquement.
                    </p>

                    <form onSubmit={handleClaimSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold mb-1.5 text-text-secondary uppercase tracking-wide">
                          1. Ton email de connexion (compte GoMytho)
                        </label>
                        <input
                          type="email"
                          value={claimEmail}
                          onChange={(e) => setClaimEmail(e.target.value)}
                          required
                          className="w-full bg-primary-bg border-2 border-lime/20 rounded-xl px-4 py-2.5 text-text-primary focus:border-lime focus:outline-none transition-all text-sm"
                          placeholder="ton@email.fr"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1.5 text-text-secondary uppercase tracking-wide">
                          2. Mot de passe
                        </label>
                        <input
                          type="password"
                          value={claimPwd}
                          onChange={(e) => setClaimPwd(e.target.value)}
                          required
                          minLength={6}
                          className="w-full bg-primary-bg border-2 border-lime/20 rounded-xl px-4 py-2.5 text-text-primary focus:border-lime focus:outline-none transition-all text-sm"
                          placeholder="6 caractères minimum"
                        />
                        <p className="text-[11px] text-text-secondary mt-1">
                          On crée le compte s'il n'existe pas encore.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1.5 text-text-secondary uppercase tracking-wide">
                          3. Email utilisé sur Stripe pour payer
                        </label>
                        <input
                          type="email"
                          value={claimStripeEmail}
                          onChange={(e) => setClaimStripeEmail(e.target.value)}
                          required
                          className="w-full bg-primary-bg border-2 border-lime/20 rounded-xl px-4 py-2.5 text-text-primary focus:border-lime focus:outline-none transition-all text-sm"
                          placeholder="email-de-ton-paiement@…"
                        />
                        <p className="text-[11px] text-text-secondary mt-1">
                          Peut être différent de celui de connexion (Apple Pay, alias…).
                        </p>
                      </div>
                      <Button type="submit" disabled={claimLoading} size="md" fullWidth>
                        {claimLoading ? 'Vérification…' : 'Récupérer mon abonnement'}
                      </Button>
                    </form>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
