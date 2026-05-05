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
    if (sessionId) {
      // Persiste le session_id en localStorage. Indispensable pour relier
      // un compte Supabase à son Customer Stripe quand les emails diffèrent
      // (Apple Pay, Google Pay, Revolut Pay, alias, casse). Le session_id
      // contient TOUJOURS le couple (customer_id, email Stripe) côté serveur,
      // donc tant qu'on l'a quelque part, on peut faire le lien — même si
      // le client ferme la fenêtre, fait OAuth, change d'onglet, etc.
      // Le flag est consommé/effacé à la première liaison réussie.
      try {
        localStorage.setItem('gomytho_pending_session_id', sessionId)
      } catch { /* ignore */ }
    }
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
