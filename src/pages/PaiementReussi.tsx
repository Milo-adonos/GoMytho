import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// Page tampon entre Stripe et /signup. AUCUNE vérif côté client : c'est /signup
// (resolveNewUserPlan) qui appelle /api/stripe-verify avec le session_id pour
// confirmer le paiement avant de permettre la création de compte. On évite
// ainsi tout écran « bloqué » si l'API tarde, échoue, ou si Stripe envoie
// l'utilisateur ici sans session_id (ex. clic sur « Retour au site »).

export default function PaiementReussi() {
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const sessionId = (searchParams.get('session_id') || '').trim()
    const target = sessionId
      ? `/signup?session_id=${encodeURIComponent(sessionId)}`
      : '/signup'
    window.location.replace(target)
  }, [searchParams])

  return (
    <div className="min-h-screen bg-primary-bg flex items-center justify-center">
      <div className="text-center px-6">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lime mx-auto mb-4" />
        <p className="text-text-primary font-bold text-lg mb-1">Paiement confirmé ✓</p>
        <p className="text-text-secondary text-sm">Redirection vers la création de ton compte…</p>
      </div>
    </div>
  )
}
