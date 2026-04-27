import { useEffect, useState } from 'react'
import { formatLastUpdated } from '@/hooks/useAutoRefresh'

interface LiveBadgeProps {
  lastUpdatedAt: number | null
  refreshing: boolean
  onRefresh: () => void
  /**
   * Si false, indique que la mise à jour est manuelle (pas d'auto-refresh).
   * Le badge passe alors en gris "Manuel" au lieu du vert "LIVE".
   */
  auto?: boolean
}

export default function LiveBadge({ lastUpdatedAt, refreshing, onRefresh, auto = true }: LiveBadgeProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const color = auto ? '#4ade80' : '#8A8FA0'
  const bg = auto ? 'rgba(74,222,128,0.08)' : 'rgba(138,143,160,0.10)'
  const border = auto ? 'rgba(74,222,128,0.25)' : 'rgba(138,143,160,0.30)'
  const label = auto ? 'LIVE' : 'MANUEL'

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold"
        style={{
          background: bg,
          border: `1px solid ${border}`,
          color,
        }}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${refreshing ? 'animate-pulse' : ''}`}
          style={{ background: color, boxShadow: auto ? `0 0 6px ${color}` : 'none' }}
        />
        {label}
        <span className="text-text-secondary font-normal">
          · MAJ {formatLastUpdated(lastUpdatedAt)}
        </span>
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="px-3 py-1.5 rounded-full text-[11px] font-bold text-lime border transition-all hover:bg-lime/10 disabled:opacity-50"
        style={{ borderColor: 'rgba(198,255,60,0.3)' }}
        title="Rafraîchir maintenant"
      >
        {refreshing ? '…' : '↻ Rafraîchir'}
      </button>
    </div>
  )
}
