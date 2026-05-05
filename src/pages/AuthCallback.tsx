import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  claimSubscriptionByPaymentEmail,
  fetchAccessProfile,
  hasPaidGoMythoAccess,
  NO_SUBSCRIPTION_FLAG_KEY,
} from '@/lib/auth-access'

// ─── Page de redirect post-OAuth ──────────────────────────────────────────
//
// Cette page existe parce que signInWithOAuth(google) renvoie l'utilisateur
// avec un hash `#access_token=...&refresh_token=...` que le SDK Supabase doit
// parser de façon asynchrone. On attend qu'une session valide existe.
//
// Comportement après authentification réussie :
//
//   1. Si `?signup_to_stripe=weekly|monthly` est présent (= flux d'inscription
//      depuis /signup → Google OAuth) → on redirige vers le Payment Link Stripe
//      avec `client_reference_id=user.id`. PAS de vérification d'accès payant
//      ici, c'est justement le point d'entrée pour s'abonner.
//
//   2. Sinon (= simple connexion via Google) → on vérifie l'accès payant en
//      DB. Pas d'abo → on déconnecte et on renvoie sur /login avec un message.
//      Avec le nouveau flux, le webhook Stripe lie via user.id donc la DB est
//      toujours à jour. Plus besoin de fallback resolve-by-stripe.

const NO_SUB_MSG =
  "Ce compte n'a pas d'abonnement actif. Choisis une offre pour commencer."

const PAYMENT_LINKS: Record<'weekly' | 'monthly', string> = {
  monthly: 'https://buy.stripe.com/fZu4gyauk4oy0rg8dVgYU00',
  weekly: 'https://buy.stripe.com/dRm6oGaukcV4c9Y1PxgYU01',
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

export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [message, setMessage] = useState('Connexion en cours…')

  useEffect(() => {
    let cancelled = false
    let resolved = false

    const proceed = async (userId: string, userEmail: string | null) => {
      if (resolved || cancelled) return
      resolved = true

      // ─── Cas 0 : flux de RÉCUPÉRATION via Google (anciens clients) ──────
      // Le user vient de cliquer « Récupérer avec mon compte Google » sur
      // /login. Il a fourni l'email Stripe qu'on a stocké en sessionStorage
      // avant le redirect. Maintenant qu'il est authentifié via Google, on
      // lance le claim côté serveur pour rattacher l'abo.
      const isClaimFlow = searchParams.get('claim') === '1'
      let claimStripeEmail: string | null = null
      try {
        claimStripeEmail = sessionStorage.getItem('gomytho_claim_stripe_email')
      } catch { /* ignore */ }
      if (isClaimFlow && claimStripeEmail) {
        try { sessionStorage.removeItem('gomytho_claim_stripe_email') } catch { /* ignore */ }
        setMessage('Récupération de ton abonnement…')
        const { data: { session: claimSession } } = await supabase.auth.getSession()
        const token = claimSession?.access_token
        if (!token) {
          try {
            sessionStorage.setItem(
              NO_SUBSCRIPTION_FLAG_KEY,
              'Connexion Google interrompue. Réessaie.',
            )
          } catch { /* ignore */ }
          navigate('/login', { replace: true })
          return
        }
        const result = await claimSubscriptionByPaymentEmail(token, claimStripeEmail)
        if (result.ok) {
          navigate('/makemytho', { replace: true })
          return
        }
        // Échec → on déconnecte (le compte Google qu'on vient de créer/ouvrir
        // n'a pas d'abo lié, on évite qu'il reste comme zombie connecté) puis
        // on renvoie vers /login avec le message d'erreur précis.
        try {
          sessionStorage.setItem(NO_SUBSCRIPTION_FLAG_KEY, result.error)
        } catch { /* ignore */ }
        try { await supabase.auth.signOut() } catch { /* ignore */ }
        navigate('/login', { replace: true })
        return
      }

      // ─── Cas 1 : flux d'inscription Google → Stripe ─────────────────────
      // Le user vient de cliquer « Continuer avec Google » sur /signup pour
      // s'abonner. On le bascule directement sur le Payment Link Stripe avec
      // son user.id en client_reference_id.
      //
      // EXCEPTION : si ce compte Google a DÉJÀ un abo actif (cas du user qui
      // se serait abonné par le passé puis re-clique « Continuer avec Google »
      // depuis /signup par erreur), on l'envoie directement dans l'app pour
      // éviter un double paiement.
      const planFromQuery = searchParams.get('signup_to_stripe')
      let planFromStorage: string | null = null
      try {
        planFromStorage = sessionStorage.getItem('gomytho_signup_to_stripe_plan')
        sessionStorage.removeItem('gomytho_signup_to_stripe_plan')
      } catch { /* ignore */ }
      const wantedPlan = planFromQuery || planFromStorage
      if (wantedPlan === 'weekly' || wantedPlan === 'monthly') {
        // Vérif anti-double-paiement
        const existing = await fetchAccessProfile(userId)
        if (hasPaidGoMythoAccess(existing)) {
          navigate('/makemytho', { replace: true })
          return
        }
        const link = buildPaymentLink(PAYMENT_LINKS[wantedPlan], {
          userId,
          email: userEmail,
        })
        try { localStorage.setItem('gomytho_pending_plan', wantedPlan) } catch { /* ignore */ }
        window.location.replace(link)
        return
      }

      // ─── Cas 2 : connexion Google standard → vérif accès payant ─────────
      const profile = await fetchAccessProfile(userId)
      if (!hasPaidGoMythoAccess(profile)) {
        try { sessionStorage.setItem(NO_SUBSCRIPTION_FLAG_KEY, NO_SUB_MSG) } catch { /* ignore */ }
        try { await supabase.auth.signOut() } catch { /* ignore */ }
        navigate('/login', { replace: true })
        return
      }

      navigate('/makemytho', { replace: true })
    }

    // 1. Listener — réagit dès que le SDK a parsé le hash et créé la session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        void proceed(session.user.id, session.user.email ?? null)
      }
    })

    // 2. Polling — au cas où le SDK ait déjà parsé avant qu'on s'abonne.
    let attempts = 0
    const maxAttempts = 50 // 50 × 200ms = 10 s
    const interval = setInterval(async () => {
      if (cancelled || resolved) return
      attempts += 1
      const { data } = await supabase.auth.getSession()
      if (data?.session?.user) {
        clearInterval(interval)
        void proceed(data.session.user.id, data.session.user.email ?? null)
        return
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval)
        if (cancelled || resolved) return
        setMessage('Connexion impossible. On te ramène à la page de connexion…')
        setTimeout(() => {
          if (!cancelled && !resolved) navigate('/login', { replace: true })
        }, 1500)
      }
    }, 200)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      clearInterval(interval)
    }
  }, [navigate, searchParams])

  return (
    <div className="min-h-screen bg-primary-bg flex flex-col items-center justify-center px-6">
      <div className="w-16 h-16 rounded-full border-4 border-lime/20 border-t-lime animate-spin mb-6" />
      <p className="text-text-secondary text-sm text-center">{message}</p>
    </div>
  )
}
