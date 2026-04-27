import { useEffect, useState } from 'react'
import { formatLastUpdated } from '@/hooks/useAutoRefresh'

interface LiveBadgeProps {
  lastUpdatedAt: number | null
  refreshing: boolean
  onRefresh: () => void
}

export default function LiveBadge({ lastUpdatedAt, refreshing, onRefresh }: LiveBadgeProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold"
        style={{
          background: 'rgba(74,222,128,0.08)',
          border: '1px solid rgba(74,222,128,0.25)',
          color: '#4ade80',
        }}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${refreshing ? 'animate-pulse' : ''}`}
          style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80' }}
        />
        LIVE
        <span className="text-text-secondary font-normal">
          · MAJ {formatLastUpdated(lastUpdatedAt)}
        </span>
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="px-3 py-1.5 rounded-full text-[11px] font-bold text-lime border transition-all hover:bg-lime/10 disabled:opacity-50"
        style={{ borderColor: 'rgba(198,255,60,0.3)' }}
      >
        {refreshing ? '…' : '↻'}
      </button>
    </div>
  )
}
