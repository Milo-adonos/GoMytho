import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

// ─── Page de redirect post-OAuth ──────────────────────────────────────────
//
// Cette page existe parce que signInWithOAuth(google) renvoie l'utilisateur
// avec un hash `#access_token=...&refresh_token=...` que le SDK Supabase doit
// parser de façon asynchrone. Si on navigue trop vite, on perd le hash et la
// session n'est pas sauvegardée. On attend donc qu'une session valide existe.
//
// Règle simple : dès qu'une session Supabase est détectée → /makemytho.
// On n'effectue aucune vérification "abonnement actif" ici — la création de
// compte est strictement réservée au flux post-paiement Stripe (/signup),
// donc l'existence d'une session = compte légitime.

export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [message, setMessage] = useState('Connexion en cours...')

  useEffect(() => {
    let cancelled = false
    let resolved = false

    const goToApp = () => {
      if (resolved || cancelled) return
      resolved = true
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
        goToApp()
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
        goToApp()
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
