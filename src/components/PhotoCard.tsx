interface PhotoCardProps {
  label: string
  sublabel: string
  /** Affiche un badge "REQUIS" subtil */
  required?: boolean
  /** Affiche un badge "OPTIONNEL" subtil */
  optional?: boolean
  /** Data URL ou URL HTTPS de la preview. Null/empty → état vide. */
  preview: string | null
  /** Loader pendant la conversion JPEG/HEIC. */
  isConverting?: boolean
  /** Click sur la carte (déclenche le file picker côté parent). */
  onClick: () => void
  /** Click sur le bouton "Changer" / "Retirer" en haut à droite. */
  onChange: () => void
}

/**
 * Carte d'upload photo carrée et stylée, à utiliser côte-à-côte dans une
 * grille 2 colonnes : Photo 1 (sujet) + Photo 2 (scène).
 *
 * - État vide : icône + label compact (cliquable).
 * - État rempli : preview en object-cover + badge top-left + bouton retire.
 * - Aspect ratio 3/4 (portrait) pour cadrer correctement les photos verticales
 *   les plus courantes côté smartphone.
 */
export default function PhotoCard({
  label,
  sublabel,
  required,
  optional,
  preview,
  isConverting,
  onClick,
  onChange,
}: PhotoCardProps) {
  const hasPreview = !!preview

  return (
    <div
      onClick={!hasPreview ? onClick : undefined}
      className={`relative aspect-[3/4] rounded-2xl overflow-hidden transition-all duration-200 ${
        hasPreview ? '' : 'cursor-pointer active:scale-[0.98]'
      }`}
      style={{
        background: hasPreview ? '#0e1322' : 'rgba(20,24,38,0.5)',
        border: hasPreview
          ? '1.5px solid rgba(198,255,60,0.4)'
          : '2px dashed rgba(198,255,60,0.2)',
        boxShadow: hasPreview ? '0 4px 24px rgba(0,0,0,0.4)' : 'none',
      }}
    >
      {/* Preview */}
      {hasPreview && (
        <img
          src={preview!}
          alt={label}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Overlay dégradé pour lisibilité du badge */}
      {hasPreview && (
        <div
          className="absolute inset-x-0 top-0 h-16 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, rgba(10,14,26,0.7) 0%, rgba(10,14,26,0) 100%)',
          }}
        />
      )}

      {/* Badge en haut-gauche */}
      <div
        className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1"
        style={{
          background: 'rgba(10,14,26,0.85)',
          color: '#C6FF3C',
          border: '1px solid rgba(198,255,60,0.3)',
          backdropFilter: 'blur(4px)',
        }}
      >
        {label}
        <span className="opacity-60">·</span>
        <span className="text-white">{sublabel}</span>
      </div>

      {/* Mini-badge requis/optionnel */}
      {!hasPreview && (required || optional) && (
        <div
          className="absolute top-2.5 right-2.5 z-10 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
          style={{
            background: required ? 'rgba(198,255,60,0.15)' : 'rgba(255,255,255,0.06)',
            color: required ? '#C6FF3C' : 'rgba(255,255,255,0.55)',
            border: required
              ? '1px solid rgba(198,255,60,0.3)'
              : '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {required ? 'Requis' : 'Optionnel'}
        </div>
      )}

      {/* Bouton retirer / changer (uniquement si preview) */}
      {hasPreview && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onChange()
          }}
          className="absolute top-2.5 right-2.5 z-10 px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95 transition-all"
          style={{
            background: 'rgba(10,14,26,0.85)',
            color: '#C6FF3C',
            border: '1px solid rgba(198,255,60,0.3)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {required ? 'Changer' : 'Retirer'}
        </button>
      )}

      {/* État vide : centre de la carte */}
      {!hasPreview && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
          {isConverting ? (
            <>
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-lime mb-2" />
              <p className="text-lime font-bold text-xs">Traitement...</p>
            </>
          ) : (
            <>
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                style={{
                  background: 'rgba(198,255,60,0.08)',
                  border: '1px solid rgba(198,255,60,0.2)',
                }}
              >
                {required ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="#C6FF3C" strokeWidth="1.8" />
                    <circle cx="12" cy="12" r="3.5" stroke="#C6FF3C" strokeWidth="1.8" />
                    <circle cx="17" cy="9" r="0.9" fill="#C6FF3C" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5v14M5 12h14" stroke="#C6FF3C" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                )}
              </div>
              <p className="font-bold text-sm leading-tight mb-0.5">
                {required ? (
                  <>Choisir<br />ta photo</>
                ) : (
                  <>Ajouter<br />une scène</>
                )}
              </p>
              <p className="text-[10.5px] text-text-secondary leading-snug">
                {required ? 'Sujet à modifier' : 'Décor de fond'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
