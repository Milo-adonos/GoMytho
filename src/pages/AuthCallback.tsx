import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

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
//   2. polling getSession() en parallèle (filet de sécurité)
//   3. navigation seulement quand session.user.id est dispo
//
// On préserve plan + session_id en URL pour qu'AppLayout puisse faire
// l'upsert post-paiement et déclencher l'auto-génération du mytho.

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
      navigate(`/resultats${query ? `?${query}` : ''}`, { replace: true })
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
