import { STAGE_MAP, CALL_OUTCOME_MAP } from '../lib/constants.js'

export function StagePill({ stage, size = 'sm' }) {
  const s = STAGE_MAP[stage] || { label: stage, color: '#8E8E93' }
  const cls = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
  return (
    <span
      className={`rounded-full font-medium ${cls}`}
      style={{ backgroundColor: s.color + '1A', color: s.color }}
    >
      {s.label}
    </span>
  )
}

export function OutcomePill({ code, size = 'sm' }) {
  if (!code) return <span className="text-muted text-xs">No calls yet</span>
  const o = CALL_OUTCOME_MAP[code] || { label: code, color: '#8E8E93' }
  const cls = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
  return (
    <span
      className={`rounded-full font-semibold ${cls}`}
      style={{ backgroundColor: o.color + '1A', color: o.color }}
    >
      {o.key || code}
    </span>
  )
}
