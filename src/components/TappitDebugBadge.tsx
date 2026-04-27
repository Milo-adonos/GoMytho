import { useEffect, useRef, useState } from 'react'

// ─── Badge de debug Tappit/Radar ─────────────────────────────────────────────
// Activé via ?taap=1 dans l'URL (et persisté en localStorage). Désactivé via
// ?taap=0 ou bouton "Fermer". Vérifie en temps réel :
//   1. Que le script tracker.js est bien dans le DOM
//   2. Qu'il a fini de charger (sinon = bloqué par ad-blocker)
//   3. Qu'un global window.taapit (ou similaire) est exposé
//   4. Combien de requêtes vers taap.it sont parties depuis l'ouverture
//
// Visible uniquement par toi (pas par les utilisateurs finaux).

const STORAGE_KEY = 'gomytho_taap_debug'

interface TrackerStatus {
  scriptInDom: boolean
  scriptLoaded: boolean
  scriptError: boolean
  globalNames: string[]
  trackingId: string | null
  requests: number
  lastRequestAt: string | null
}

const initialStatus: TrackerStatus = {
  scriptInDom: false,
  scriptLoaded: false,
  scriptError: false,
  globalNames: [],
  trackingId: null,
  requests: 0,
  lastRequestAt: null,
}

export default function TappitDebugBadge() {
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<TrackerStatus>(initialStatus)
  const requestsRef = useRef(0)

  // ── Activation / désactivation via query string ─────────────────────────
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const flag = params.get('taap')
      if (flag === '1') localStorage.setItem(STORAGE_KEY, '1')
      else if (flag === '0') localStorage.removeItem(STORAGE_KEY)
      setEnabled(localStorage.getItem(STORAGE_KEY) === '1')
    } catch { /* ignore */ }
  }, [])

  // ── Observation des requêtes réseau vers taap.it ────────────────────────
  useEffect(() => {
    if (!enabled) return
    if (typeof PerformanceObserver === 'undefined') return

    // Compte les requêtes déjà arrivées avant le mount du composant.
    try {
      const existing = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      requestsRef.current = existing.filter((e) => /taap\.it/.test(e.name)).length
    } catch { /* ignore */ }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (/taap\.it/.test(entry.name)) {
          requestsRef.current += 1
          setStatus((s) => ({
            ...s,
            requests: requestsRef.current,
            lastRequestAt: new Date().toLocaleTimeString(),
          }))
        }
      }
    })
    try {
      observer.observe({ type: 'resource', buffered: true })
    } catch {
      try { observer.observe({ entryTypes: ['resource'] }) } catch { /* ignore */ }
    }
    return () => observer.disconnect()
  }, [enabled])

  // ── Refresh régulier de l'état du script + globaux ──────────────────────
  useEffect(() => {
    if (!enabled) return
    const refresh = () => {
      const script = document.querySelector(
        'script[src*="taap.it"]'
      ) as HTMLScriptElement | null

      const w = window as any
      const candidates = ['taapit', 'tappit', 'Tappit', 'radar', 'Radar', 'snitcher']
      const globalNames = candidates.filter((c) => typeof w[c] !== 'undefined')

      let trackingId: string | null = null
      try {
        if (typeof w.taapit?.getTrackingId === 'function') {
          trackingId = w.taapit.getTrackingId() || null
        }
      } catch { /* ignore */ }

      setStatus((s) => ({
        ...s,
        scriptInDom: !!script,
        // readyState 'loading' = pas fini ; sinon tag <script> est résolu
        scriptLoaded: !!script && !!script.async === true && requestsRef.current > 0,
        scriptError: false,
        globalNames,
        trackingId,
      }))
    }
    refresh()
    const interval = setInterval(refresh, 1500)
    return () => clearInterval(interval)
  }, [enabled])

  if (!enabled) return null

  const allOk =
    status.scriptInDom &&
    (status.requests > 0 || status.globalNames.length > 0)

  const color = allOk ? '#76e155' : status.scriptInDom ? '#ffce6b' : '#ff6464'
  const title = allOk
    ? 'Radar ACTIF'
    : status.scriptInDom
      ? 'Script présent, mais aucune requête (ad-blocker ?)'
      : 'Script absent du DOM'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 99999,
        background: 'rgba(20, 24, 38, 0.92)',
        color: 'white',
        padding: '10px 12px',
        borderRadius: 10,
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
        maxWidth: 320,
        border: `1px solid ${color}55`,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        lineHeight: 1.4,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 8px ${color}`,
            flex: '0 0 auto',
          }}
        />
        <strong style={{ color, fontSize: 12 }}>{title}</strong>
        <button
          onClick={() => {
            try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
            setEnabled(false)
          }}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
            lineHeight: 1,
          }}
          title="Fermer le debug"
        >
          ×
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
        <span style={{ opacity: 0.6 }}>Script :</span>
        <span>{status.scriptInDom ? '✅ chargé' : '❌ absent'}</span>

        <span style={{ opacity: 0.6 }}>Globaux :</span>
        <span>
          {status.globalNames.length > 0
            ? `✅ ${status.globalNames.join(', ')}`
            : '⏳ en attente'}
        </span>

        <span style={{ opacity: 0.6 }}>Requêtes :</span>
        <span>
          {status.requests > 0 ? `✅ ${status.requests}` : '⏳ 0'}
        </span>

        {status.lastRequestAt && (
          <>
            <span style={{ opacity: 0.6 }}>Dernière :</span>
            <span>{status.lastRequestAt}</span>
          </>
        )}

        {status.trackingId && (
          <>
            <span style={{ opacity: 0.6 }}>tid :</span>
            <span style={{ fontSize: 10, wordBreak: 'break-all' }}>
              {status.trackingId.slice(0, 12)}…
            </span>
          </>
        )}
      </div>

      {!status.scriptInDom && (
        <p style={{ marginTop: 8, color: '#ffaaaa', fontSize: 10, opacity: 0.9 }}>
          Vérifie que le script taap.it est bien dans <code>index.html</code>.
        </p>
      )}
      {status.scriptInDom && status.requests === 0 && (
        <p style={{ marginTop: 8, color: '#ffce6b', fontSize: 10, opacity: 0.9 }}>
          Désactive ton ad-blocker et recharge la page.
        </p>
      )}

      <p style={{ marginTop: 8, opacity: 0.45, fontSize: 10 }}>
        ?taap=0 dans l'URL pour désactiver
      </p>
    </div>
  )
}
