import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Banner d'erreur post-génération. Lit sessionStorage.gomytho_last_gen_error
// (posé par AppLayout, AppCreate ou Signup quand une génération échoue).
// Auto-dismiss possible. CTA "Réessayer" emmène sur /makemytho avec restore
// des pending data (déjà gérée dans AppCreate).

export interface GenError {
  code: string
  message: string
  blocked?: boolean
}

const STORAGE_KEY = 'gomytho_last_gen_error'

export function readGenError(): GenError | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw) as GenError
    if (obj && typeof obj.message === 'string') return obj
  } catch { /* ignore */ }
  return null
}

export function clearGenError(): void {
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export function setGenError(err: GenError): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(err)) } catch { /* ignore */ }
}

interface Props {
  showRetryCta?: boolean
  /** Auto-dismiss en ms (0 = jamais). Utile pour les erreurs non bloquantes. */
  autoDismissMs?: number
}

export default function GenErrorBanner({ showRetryCta = true, autoDismissMs = 0 }: Props) {
  const [err, setErr] = useState<GenError | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    setErr(readGenError())
  }, [])

  // Auto-dismiss optionnel : on retire l'erreur après le délai indiqué
  // pour ne pas laisser un bandeau « Génération échouée » sticky pendant
  // que l'utilisateur prépare une nouvelle tentative.
  useEffect(() => {
    if (!err || !autoDismissMs || err.blocked) return
    const t = setTimeout(() => {
      clearGenError()
      setErr(null)
    }, autoDismissMs)
    return () => clearTimeout(t)
  }, [err, autoDismissMs])

  if (!err) return null

  const isBlocked = !!err.blocked
  const title = isBlocked ? '🛑 Contenu refusé par l\'IA' : '⚠️ Génération échouée'

  const close = () => {
    clearGenError()
    setErr(null)
  }

  const retry = () => {
    clearGenError()
    setErr(null)
    navigate('/makemytho?pending=1')
  }

  return (
    <div
      role="alert"
      className="rounded-2xl p-4 mb-5 flex flex-col gap-3"
      style={{
        background: isBlocked ? 'rgba(255,80,80,0.08)' : 'rgba(255,180,60,0.08)',
        border: isBlocked
          ? '1px solid rgba(255,80,80,0.4)'
          : '1px solid rgba(255,180,60,0.4)',
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p
            className="font-bold text-sm mb-1"
            style={{ color: isBlocked ? '#ff8a8a' : '#ffce6b' }}
          >
            {title}
          </p>
          <p className="text-text-primary text-sm leading-relaxed">{err.message}</p>
          {isBlocked && (
            <p className="text-text-secondary text-xs mt-2 leading-relaxed">
              Astuce : utilise ta propre photo, un personnage anonyme ou des objets.
              Évite les noms de célébrités, marques, contenus violents ou sexuels.
            </p>
          )}
        </div>
        <button
          onClick={close}
          aria-label="Fermer"
          className="text-text-secondary hover:text-text-primary text-xl leading-none px-2 -mt-1"
        >
          ×
        </button>
      </div>

      {showRetryCta && (
        <button
          onClick={retry}
          className="w-full py-3 rounded-full bg-lime text-primary-bg font-bold text-sm active:scale-95 transition-transform"
        >
          Réessayer avec un nouveau prompt
        </button>
      )}
    </div>
  )
}
