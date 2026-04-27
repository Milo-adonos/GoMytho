import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

// ─── Page de redirection post-OAuth ───────────────────────────────────────
//
// Pourquoi cette page existe ?
// Lors d'un signInWithOAuth Google, Supabase fait :
//   user → Google → callback Supabase → redirectTo final.
// Si redirectTo n'est pas dans la liste des "Redirect URLs" autorisées
// dans le dashboard Supabase, le user atterrit sur la Site URL (souvent
// la landing /). On perd alors les query params (plan, session_id) et
// le user reste bloqué sur la landing.
//
// On centralise ici une seule URL : /auth/callback. C'est la seule à
// inscrire en allowlist côté Supabase. Cette page :
//   1. Attend que la session OAuth soit bien établie côté client.
//   2. Lit les query params (plan, session_id) pour le post-paiement.
//   3. Redirige vers /resultats (route protégée par AppLayout, qui gère
//      l'upsert du plan + l'auto-génération si pending data).
//   4. Si pas de session après timeout → /login.

async function waitForSession(maxAttempts = 30, delayMs = 200) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const { data } = await supabase.auth.getSession()
    if (data?.session) return data.session
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

export default function AuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Supabase auto-détecte le hash #access_token=... au mount du SDK et
      // crée la session. On attend juste qu'elle soit dispo.
      const session = await waitForSession()
      if (cancelled) return

      if (!session) {
        navigate('/login', { replace: true })
        return
      }

      // Préserve plan + session_id pour permettre l'upsert post-paiement
      // dans AppLayout (qui fera l'appel à /api/stripe-verify).
      const plan = searchParams.get('plan')
      const sessionId = searchParams.get('session_id')
      const params = new URLSearchParams()
      if (plan) params.set('plan', plan)
      if (sessionId) params.set('session_id', sessionId)
      const query = params.toString()
      navigate(`/resultats${query ? `?${query}` : ''}`, { replace: true })
    })()
    return () => { cancelled = true }
  }, [navigate, searchParams])

  return (
    <div className="min-h-screen bg-primary-bg flex flex-col items-center justify-center px-6">
      <div className="w-16 h-16 rounded-full border-4 border-lime/20 border-t-lime animate-spin mb-6" />
      <p className="text-text-secondary text-sm">Connexion en cours...</p>
    </div>
  )
}
