import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// Page de retour Stripe — flux 2026-05-05.
//
// Avec le nouveau flux « inscription AVANT paiement », l'utilisateur arrive
// ici DÉJÀ authentifié sur Supabase :
//   /unlock → /signup (créer compte) → Stripe → /paiementreussi (ici) → /makemytho
//
// Le webhook Stripe a (ou va) écrire le plan dans `public.users` via le
// `client_reference_id` (= user.id Supabase). On n'a donc plus besoin de
// vérifier le paiement côté client (l'ancien `stripe-verify`) — AppLayout
// fera un polling DB de quelques secondes pour attendre le webhook si
// besoin, et lance l'auto-génération automatiquement.

export default function PaiementReussi() {
  const [searchParams] = useSearchParams()

  useEffect(() => {
    // On préserve `session_id` dans l'URL ET en localStorage. Sans ça,
    // un refresh sur `/makemytho` sans query string fait perdre le seul
    // signal permettant au fallback `/api/stripe-verify` de forcer la sync
    // si le webhook Stripe tarde ou échoue.
    const sessionId = (searchParams.get('session_id') || '').trim()
    if (sessionId && /^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
      try {
        localStorage.setItem('gomytho_pending_session_id', sessionId)
      } catch { /* ignore */ }
      window.location.replace(`/makemytho?session_id=${encodeURIComponent(sessionId)}`)
      return
    }
    window.location.replace('/makemytho')
  }, [searchParams])

  return (
    <div className="min-h-screen bg-primary-bg flex items-center justify-center">
      <div className="text-center px-6">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lime mx-auto mb-4" />
        <p className="text-text-primary font-bold text-lg mb-1">Paiement confirmé ✓</p>
        <p className="text-text-secondary text-sm">Activation de ton compte…</p>
      </div>
    </div>
  )
}
