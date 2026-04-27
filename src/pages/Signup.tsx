import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import Header from '@/components/Header'
import Button from '@/components/Button'
import { supabase } from '@/lib/supabase'
import { generateMytho, uploadToSupabase } from '@/lib/kie-api'
import { saveMythoToCloud } from '@/lib/mythos-sync'
import type { AspectRatio } from '@/lib/kie-api'
import { resolveNewUserPlan, cachePlanLocally, PLAN_LABELS, type VerifiedPlan } from '@/lib/plan'

export default function Signup() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [genStep, setGenStep] = useState('')
  const [error, setError] = useState('')
  const [verified, setVerified] = useState<VerifiedPlan | null>(null)

  useEffect(() => {
    let alive = true
    void resolveNewUserPlan(searchParams).then((v) => {
      if (alive) setVerified(v)
    })
    return () => { alive = false }
  }, [searchParams])

  async function persistUserProfile(userId: string, userEmail: string, plan: VerifiedPlan) {
    // Toujours upsert dans public.users — la vérification du paiement est notre
    // seule source de vérité pour le plan + les crédits (cross-device).
    // On stocke aussi stripe_customer_id (s'il a été retourné par stripe-verify)
    // pour permettre à l'API stripe-portal d'ouvrir le portail sans re-chercher
    // par email (évite l'erreur "No Stripe customer found" plus tard).
    try {
      const row: Record<string, unknown> = {
        id: userId,
        email: userEmail,
        credits_remaining: plan.credits,
        subscription_status: 'active',
        plan: plan.plan,
      }
      if (plan.customerId) row.stripe_customer_id = plan.customerId
      // Email réellement utilisé sur Stripe (peut différer de userEmail si
      // paiement Apple Pay / Google Pay / alias). Permet à stripe-portal de
      // retrouver le customer même quand stripe_customer_id manque.
      if (plan.email && plan.email !== userEmail) {
        row.stripe_payment_email = plan.email
      } else if (plan.email) {
        row.stripe_payment_email = plan.email
      }
      await supabase.from('users').upsert([row], { onConflict: 'id' })
    } catch (err) {
      console.warn('[signup] upsert users échoué (non bloquant):', err)
    }
    cachePlanLocally(plan.plan, plan.credits)
    try {
      localStorage.removeItem('gomytho_pending_plan')
    } catch { /* ignore */ }
  }

  async function runAutoGeneration(userId: string) {
    const pendingImage = localStorage.getItem('gomytho_pending_image')
    const pendingImage2 = localStorage.getItem('gomytho_pending_image2')
    const pendingPrompt = localStorage.getItem('gomytho_pending_prompt')
    const pendingRatio = (localStorage.getItem('gomytho_pending_ratio') || '9:16') as AspectRatio

    if (!pendingImage || !pendingPrompt) {
      window.location.href = '/resultats'
      return
    }

    setIsLoading(false)
    setIsGenerating(true)
    try {
      setGenStep('Conversion de ta photo...')
      const res = await fetch(pendingImage)
      const blob = await res.blob()
      const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })

      let file2: File | null = null
      if (pendingImage2) {
        try {
          const res2 = await fetch(pendingImage2)
          const blob2 = await res2.blob()
          file2 = new File([blob2], 'photo2.jpg', { type: 'image/jpeg' })
        } catch (e2) {
          console.warn('[signup] décodage photo 2 échoué:', e2)
        }
      }

      setGenStep(file2 ? 'Upload de tes photos...' : 'Upload de ta photo...')
      const publicUrl = await uploadToSupabase(file, userId)
      let publicUrl2: string | null = null
      if (file2) {
        try {
          publicUrl2 = await uploadToSupabase(file2, userId)
        } catch (e2) {
          console.warn('[signup] upload photo 2 échoué:', e2)
        }
      }
      const imageUrls = publicUrl2 ? [publicUrl, publicUrl2] : [publicUrl]

      setGenStep('Génération de ton mytho...')
      const { dataUrl } = await generateMytho(
        { userPrompt: pendingPrompt, imageUrls, aspectRatio: pendingRatio },
        (s) => setGenStep(s)
      )

      setGenStep('Sauvegarde...')
      await saveMythoToCloud({ userId, generatedDataUrl: dataUrl, prompt: pendingPrompt })

      localStorage.removeItem('gomytho_pending_image')
      localStorage.removeItem('gomytho_pending_image2')
      localStorage.removeItem('gomytho_pending_prompt')
      localStorage.removeItem('gomytho_pending_ratio')
      window.location.href = '/resultats'
    } catch (genErr) {
      console.warn('[signup] auto-génération échouée :', genErr)
      // En cas d'échec, on garde les pending data pour permettre une relance
      // manuelle, mais on emmène toujours le user dans Créations (pour qu'il
      // ne se retrouve pas perdu sur /makemytho avec un message ambigu).
      try {
        alert('La génération automatique a rencontré un souci. Tu peux relancer depuis l\'onglet "Créer".')
      } catch { /* ignore */ }
      window.location.href = '/resultats'
    }
  }

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    const planToAssign = verified ?? (await resolveNewUserPlan(searchParams))

    try {
      const { data, error: signUpErr } = await supabase.auth.signUp({ email, password })

      if (signUpErr) {
        // Compte existant → on bascule sur login en gardant les pending data
        if (/already registered|already exists|user.*exists/i.test(signUpErr.message)) {
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
          if (signInErr || !signInData.session) {
            setError(`❌ Un compte existe déjà avec cet email. Connecte-toi depuis la page Login.`)
            setIsLoading(false)
            return
          }
          // Connexion OK → traiter comme un nouveau signup pour upsert du plan
          await persistUserProfile(signInData.session.user.id, signInData.session.user.email || email, planToAssign)
          await runAutoGeneration(signInData.session.user.id)
          return
        }
        throw signUpErr
      }

      if (!data.user) {
        setError('Création du compte impossible (utilisateur non créé). Réessaie.')
        setIsLoading(false)
        return
      }

      // Si email confirmation activée, signUp ne retourne pas de session.
      let session = data.session
      if (!session) {
        const { data: signInData } = await supabase.auth.signInWithPassword({ email, password })
        session = signInData?.session ?? null
      }

      if (!session) {
        // Email confirmation activée dans Supabase → on ne peut pas auto-loguer.
        // On persist quand même le plan en DB (via service role côté trigger),
        // et on guide le user vers la confirmation puis le login.
        setError('📧 Vérifie ta boîte mail (et les spams) pour confirmer ton compte, puis connecte-toi.')
        setIsLoading(false)
        return
      }

      const userId = session.user.id
      const userEmail = session.user.email || email
      await persistUserProfile(userId, userEmail, planToAssign)
      await runAutoGeneration(userId)
    } catch (e: unknown) {
      const err = e as { message?: string }
      setError(err.message || 'Une erreur est survenue')
      setIsLoading(false)
    }
  }

  const handleGoogleSignup = async () => {
    setIsLoading(true)
    setError('')

    try {
      const planQuery = verified?.plan || 'monthly'
      const sessionParam = searchParams.get('session_id')
      const sidQuery = sessionParam ? `&session_id=${encodeURIComponent(sessionParam)}` : ''
      const origin = window.location.origin
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // /auth/callback préserve plan + session_id puis redirige vers
          // /resultats. AppLayout y fait l'upsert post-paiement et lance
          // l'auto-génération du mytho.
          redirectTo: `${origin}/auth/callback?plan=${planQuery}${sidQuery}`,
        },
      })
      if (oauthErr) throw oauthErr
    } catch (e: unknown) {
      const err = e as { message?: string }
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
            {verified && (
              <div className="inline-flex items-center gap-2 bg-lime/10 border border-lime/30 rounded-full px-4 py-1.5">
                <span className="w-2 h-2 rounded-full bg-lime animate-pulse" />
                <span className="text-lime text-sm font-semibold">
                  Plan {PLAN_LABELS[verified.plan]} — {verified.credits} crédits
                  {verified.source === 'stripe' && <span className="ml-1 opacity-70">· Paiement vérifié ✓</span>}
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

            <p className="text-center text-sm text-text-secondary mt-4">
              Déjà un compte ?{' '}
              <Link to="/login" className="text-lime hover:underline font-semibold">
                Se connecter
              </Link>
            </p>
          </motion.div>

        </div>
      </div>
    </div>
  )
}
