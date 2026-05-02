import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  fetchAccessProfile,
  hasPaidGoMythoAccess,
  shouldBypassAccessCheck,
  NO_SUBSCRIPTION_FLAG_KEY,
} from '@/lib/auth-access'

// ─── Page de redirect post-OAuth ──────────────────────────────────────────
//
// Cette page existe parce que signInWithOAuth(google) renvoie l'utilisateur
// avec un hash `#access_token=...&refresh_token=...` que le SDK Supabase doit
// parser de façon asynchrone. Si on navigue trop vite, on perd le hash et la
// session n'est pas sauvegardée. On attend donc qu'une session valide existe.
//
// Règle d'accès (corrigée le 2026-05-02) : Google OAuth crée automatiquement
// un compte Supabase pour n'importe quel email Google. Donc on NE peut PAS
// se contenter de "session existe → on entre". On vérifie le profil DB :
// pas d'abonnement payant → sign-out + redirection vers /login avec un
// message clair. Bypass autorisé si l'utilisateur revient juste de Stripe
// (`?session_id=`) ou est dans le flux signup post-paiement.

const NO_SUB_MSG =
  "Ce compte n'a pas d'abonnement actif. Choisis une offre pour commencer."

export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [message, setMessage] = useState('Connexion en cours...')

  useEffect(() => {
    let cancelled = false
    let resolved = false

    const proceed = async (userId: string) => {
      if (resolved || cancelled) return
      resolved = true

      // Bypass : si on revient juste de Stripe ou si on est dans le flux
      // signup, on ne contrôle pas l'accès payant (le webhook peut ne pas
      // avoir fini, AppLayout fera l'upsert avec le session_id).
      if (!shouldBypassAccessCheck(searchParams)) {
        const profile = await fetchAccessProfile(userId)
        if (!hasPaidGoMythoAccess(profile)) {
          // Sign out → empêche l'accès aux pages internes via la session
          // OAuth qui vient d'être créée. On renvoie sur /login avec un
          // message lu sur cette même page.
          try {
            sessionStorage.setItem(NO_SUBSCRIPTION_FLAG_KEY, NO_SUB_MSG)
          } catch { /* ignore */ }
          try { await supabase.auth.signOut() } catch { /* ignore */ }
          navigate('/login', { replace: true })
          return
        }
      }

      try { sessionStorage.removeItem('gomytho_signup_flow') } catch { /* ignore */ }
      const plan = searchParams.get('plan')
      const sessionId = searchParams.get('session_id')
      const params = new URLSearchParams()
      if (plan) params.set('plan', plan)
      if (sessionId) params.set('session_id', sessionId)
      const query = params.toString()
      navigate(`/makemytho${query ? `?${query}` : ''}`, { replace: true })
    }

    // 1. Listener — réagit dès que le SDK a parsé le hash et créé la session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        void proceed(session.user.id)
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
        void proceed(data.session.user.id)
        return
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval)
        if (cancelled || resolved) return
        setMessage('Connexion impossible. On te ramène à la page de connexion...')
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
