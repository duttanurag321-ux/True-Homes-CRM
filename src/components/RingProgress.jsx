export default function RingProgress({ done, total, size = 120, stroke = 12, color = '#0071E3' }) {
  const pct = total === 0 ? 1 : Math.min(1, done / total)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct)
  const complete = total > 0 && done >= total

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#E5E5EA" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={complete ? '#34C759' : color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1), stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {complete ? (
          <span className="text-2xl">🎉</span>
        ) : (
          <>
            <span className="text-2xl font-semibold tabular-nums">{done}</span>
            <span className="text-xs text-muted -mt-0.5">of {total}</span>
          </>
        )}
      </div>
    </div>
  )
}
