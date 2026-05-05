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
    // On préserve `session_id` dans l'URL de destination pour qu'AppLayout
    // sache qu'on est dans la phase « post-paiement immédiat » (utile pour
    // le bypass de l'access check le temps que le webhook arrive).
    const sessionId = (searchParams.get('session_id') || '').trim()
    const target = sessionId
      ? `/makemytho?session_id=${encodeURIComponent(sessionId)}`
      : '/makemytho'
    window.location.replace(target)
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
