import { AspectRatio } from '@/lib/kie-api'

interface Props {
  value: AspectRatio
  onChange: (ratio: AspectRatio) => void
}

const options: { ratio: AspectRatio; icon: string; label: string; sub: string }[] = [
  { ratio: '9:16', icon: '📱', label: 'Vertical 9:16', sub: 'Story / TikTok' },
  { ratio: '16:9', icon: '🖥️', label: 'Horizontal 16:9', sub: 'YouTube / Paysage' },
]

export default function AspectRatioSelector({ value, onChange }: Props) {
  return (
    <div className="mb-6">
      <label className="block text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wider">
        Format de sortie
      </label>
      <div className="flex gap-3">
        {options.map(opt => {
          const active = value === opt.ratio
          return (
            <button
              key={opt.ratio}
              onClick={() => onChange(opt.ratio)}
              className="flex-1 flex flex-col items-center gap-1 px-4 py-4 rounded-xl border transition-all duration-200 active:scale-95"
              style={{
                background: active ? 'rgba(198,255,60,0.05)' : '#141826',
                borderColor: active ? '#C6FF3C' : 'rgba(198,255,60,0.12)',
                boxShadow: active ? '0 0 16px rgba(198,255,60,0.15)' : 'none',
              }}
            >
              <span className="text-2xl">{opt.icon}</span>
              <span className={`text-sm font-bold transition-colors ${active ? 'text-lime' : 'text-text-primary'}`}>
                {opt.label}
              </span>
              <span className="text-[11px] text-text-secondary">{opt.sub}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
