import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchAccessProfile, hasPaidGoMythoAccess } from '@/lib/auth-access'

// ─── Page de redirect post-OAuth (version simplifiée) ───────────────────
//
// Cette page existe parce que signInWithOAuth(google) renvoie l'utilisateur
// avec un hash `#access_token=...&refresh_token=...` que le SDK Supabase
// doit parser de façon asynchrone. On attend qu'une session valide existe.
//
// Comportement après authentification réussie :
//   1. Si `?signup_to_stripe=weekly|monthly` est présent (= flux signup
//      via Google) → redirige vers Stripe avec client_reference_id=user.id.
//   2. Sinon (= simple connexion Google) → si abonné → /makemytho ;
//      sinon → /choixoffre (l'utilisateur peut activer son abo).

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

      // ─── Cas 1 : flux signup Google → Stripe ──────────────────────────
      const planFromQuery = searchParams.get('signup_to_stripe')
      let planFromStorage: string | null = null
      try {
        planFromStorage = sessionStorage.getItem('gomytho_signup_to_stripe_plan')
        sessionStorage.removeItem('gomytho_signup_to_stripe_plan')
      } catch { /* ignore */ }
      const wantedPlan = planFromQuery || planFromStorage
      if (wantedPlan === 'weekly' || wantedPlan === 'monthly') {
        const existing = await fetchAccessProfile(userId)
        if (hasPaidGoMythoAccess(existing)) {
          navigate('/makemytho', { replace: true })
          return
        }
        try { localStorage.setItem('gomytho_pending_plan', wantedPlan) } catch { /* ignore */ }
        const link = buildPaymentLink(PAYMENT_LINKS[wantedPlan], {
          userId,
          email: userEmail,
        })
        window.location.replace(link)
        return
      }

      // ─── Cas 2 : connexion Google standard ────────────────────────────
      const profile = await fetchAccessProfile(userId)
      if (hasPaidGoMythoAccess(profile)) {
        navigate('/makemytho', { replace: true })
      } else {
        // Pas d'abo → vers le choix d'offre, sans déconnecter (la session
        // sera réutilisée pour le paiement Stripe).
        navigate('/choixoffre', { replace: true })
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        void proceed(session.user.id, session.user.email ?? null)
      }
    })

    let attempts = 0
    const maxAttempts = 50
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
