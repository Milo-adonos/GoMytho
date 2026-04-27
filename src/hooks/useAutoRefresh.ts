import { useEffect, useRef, useState } from 'react'

// ─── Hook de rafraîchissement automatique ────────────────────────────────────
//
// Appelle `fetcher` à intervalle régulier (par défaut 10s) et expose :
//   - data           : les dernières données chargées
//   - loading        : true uniquement au tout premier chargement
//   - refreshing     : true pendant un fetch en arrière-plan
//   - error          : éventuelle erreur du dernier fetch
//   - lastUpdatedAt  : timestamp du dernier succès
//   - refresh()      : déclenche un fetch immédiat
//
// Le hook met aussi le fetch en pause quand l'onglet n'est pas visible
// (économie de bande passante + de quota Vercel).
export interface AutoRefreshOptions {
  intervalMs?: number
  initialDelayMs?: number
}

export interface AutoRefreshResult<T> {
  data: T | null
  loading: boolean
  refreshing: boolean
  error: Error | null
  lastUpdatedAt: number | null
  refresh: () => Promise<void>
}

export function useAutoRefresh<T>(
  fetcher: () => Promise<T>,
  opts: AutoRefreshOptions = {}
): AutoRefreshResult<T> {
  const { intervalMs = 10000, initialDelayMs = 0 } = opts
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const aliveRef = useRef(true)
  const inFlightRef = useRef(false)

  const run = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (data === null) setLoading(true)
    else setRefreshing(true)
    try {
      const next = await fetcher()
      if (!aliveRef.current) return
      setData(next)
      setLastUpdatedAt(Date.now())
      setError(null)
    } catch (e: any) {
      if (!aliveRef.current) return
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      if (aliveRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
      inFlightRef.current = false
    }
  }

  useEffect(() => {
    aliveRef.current = true
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void run()
      }, intervalMs)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run()
    }

    const init = setTimeout(() => {
      void run()
      start()
    }, initialDelayMs)

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      aliveRef.current = false
      clearTimeout(init)
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, initialDelayMs])

  return {
    data,
    loading,
    refreshing,
    error,
    lastUpdatedAt,
    refresh: run,
  }
}

// ─── Petit composant d'indicateur "Live + dernier rafraîchissement" ──────────
export function formatLastUpdated(lastUpdatedAt: number | null): string {
  if (!lastUpdatedAt) return 'jamais'
  const diff = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000))
  if (diff < 5) return "à l'instant"
  if (diff < 60) return `il y a ${diff}s`
  const m = Math.floor(diff / 60)
  if (m < 60) return `il y a ${m}min`
  return `il y a ${Math.floor(m / 60)}h`
}
