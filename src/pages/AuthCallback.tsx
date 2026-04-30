import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { hasPaidGoMythoAccess, resolveAccessProfile } from '@/lib/auth-access'
import type { Session } from '@supabase/supabase-js'

// ─── Page de redirect post-OAuth ──────────────────────────────────────────
//
// Pourquoi exister ?
// signInWithOAuth(google) renvoie l'utilisateur sur :
//   <project>.supabase.co/auth/v1/callback → notre redirectTo final
// avec un hash `#access_token=...&refresh_token=...`. Le SDK Supabase
// PARSE ce hash de façon asynchrone au mount, sauvegarde la session en
// localStorage, puis émet onAuthStateChange('SIGNED_IN').
//
// Si on navigue trop vite (avant que le SDK ait fini de parser), on perd
// le hash dans l'URL et la session n'est jamais sauvegardée. L'utilisateur
// se retrouve "non connecté" et est rejeté à la prochaine route protégée.
//
// Cette page reste affichée tant qu'on n'a pas une session VALIDE :
//   1. abonnement à onAuthStateChange (réagit à 'SIGNED_IN' / 'INITIAL_SESSION')
//   ...
// Si l’utilisateur vient seulement de « Se connecter » (sans session_id
// Stripe), on vérifie public.users : sans abonnement/crédits → déconnexion.
// Avec session_id dans l’URL, on laisse passer vers l’app pour finaliser le paiement.

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
      const plan = searchParams.get('plan')
      const sessionId = searchParams.get('session_id')
      const params = new URLSearchParams()
      if (plan) params.set('plan', plan)
      if (sessionId) params.set('session_id', sessionId)
      const query = params.toString()
      // Atterrissage souhaité : page Créer (l'utilisateur peut consulter ses
      // mythos via la bottom nav). AppLayout y exécute aussi l'éventuel
      // upsert post-paiement et l'auto-génération si pending photos.
      navigate(`/makemytho${query ? `?${query}` : ''}`, { replace: true })
    }

    const proceedAfterSession = async (session: Session) => {
      if (cancelled || resolved) return
      const sessionId = searchParams.get('session_id')
      if (sessionId) {
        goToApp()
        return
      }

      // Si on arrive d'un parcours INSCRIPTION (Google Signup depuis /signup),
      // on laisse PASSER systématiquement vers /makemytho. AppLayout gère la
      // suite (upsert plan, redirect vers /choixoffre si pas d'abonnement).
      // On ne renvoie JAMAIS un nouvel inscrit vers /login.
      let isSignupFlow = searchParams.get('signup') === '1'
      if (!isSignupFlow) {
        try { isSignupFlow = sessionStorage.getItem('gomytho_signup_flow') === '1' } catch { /* ignore */ }
      }
      if (isSignupFlow) {
        try { sessionStorage.removeItem('gomytho_signup_flow') } catch { /* ignore */ }
        goToApp()
        return
      }

      // Cherche le profil payé : d'abord par id (cas nominal), puis fallback
      // par email — couvre le cas du client qui a payé sous email/mot de passe
      // mais essaye de revenir via Google (Supabase peut créer une nouvelle
      // auth.user avec un id différent si l'identity linking n'est pas activé).
      const profile = await resolveAccessProfile(session.user.id, session.user.email)
      if (!hasPaidGoMythoAccess(profile)) {
        resolved = true
        try {
          const { resetAnalytics } = await import('@/lib/analytics')
          resetAnalytics()
        } catch { /* ignore */ }
        await supabase.auth.signOut()
        navigate('/login?reason=no_access', { replace: true })
        return
      }
      goToApp()
    }

    // 1. Listener — réagit dès que le SDK a parsé le hash et créé la session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        void proceedAfterSession(session)
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
        void proceedAfterSession(data.session)
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
