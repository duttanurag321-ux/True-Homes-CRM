import { useEffect, useState, useCallback, useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import { PageLoader } from '../components/Loader.jsx'
import { setPersisted } from '../lib/usePersistedState.js'
import { todayStr, localMonthBoundsUTC } from '../lib/helpers.js'
import { STAGES, CALL_OUTCOMES } from '../lib/constants.js'
import { useRegisterRefresh } from '../lib/RefreshContext.jsx'

const STAGE_ORDER = STAGES.map((s) => s.key)
const SV_DONE_RANK = STAGE_ORDER.indexOf('sv_done')

// Fewer, clearly-worded sort options rather than terse column names —
// this was one of the confusing parts before.
const SORT_OPTIONS = [
  { key: 'pendingToday', label: 'Most follow-ups pending' },
  { key: 'uncalled', label: 'Most new leads waiting' },
  { key: 'overdue', label: 'Most overdue' },
  { key: 'svDone', label: 'Most SVs done' },
  { key: 'won', label: 'Most won' }
]

export default function TeamPerformance() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [sortKey, setSortKey] = useState('pendingToday')

  const load = useCallback(async () => {
    setLoading(true)
    const today = todayStr()
    const { startISO: monthStart, endISO: monthEnd } = localMonthBoundsUTC()

    const [{ data: agents }, { data: leads }, { data: monthActs }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email,receiving_leads').eq('role', 'agent').order('full_name'),
      supabase.from('leads').select('id,assigned_to,status,call_status,next_followup_date,created_at'),
      supabase
        .from('activities')
        .select('lead_id,user_id,stage_at_time,created_at,followup_date')
        .in('stage_at_time', ['sv_scheduled', 'sv_done'])
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd)
    ])

    // Same cross-check as the SV Report / Home dashboard: a stage only
    // counts if the lead's CURRENT status still backs it up, so a mark
    // that got changed or undone stops showing up here too.
    const leadIds = Array.from(new Set((monthActs || []).map((a) => a.lead_id)))
    let statusMap = new Map()
    if (leadIds.length) {
      const { data: current } = await supabase.from('leads').select('id,status').in('id', leadIds)
      statusMap = new Map((current || []).map((l) => [l.id, l.status]))
    }
    const latestScheduled = new Map()
    const latestDone = new Map()
    ;(monthActs || []).forEach((a) => {
      if (a.stage_at_time === 'sv_scheduled') {
        const prev = latestScheduled.get(a.lead_id)
        if (!prev || a.created_at > prev.created_at) latestScheduled.set(a.lead_id, a)
      }
      if (a.stage_at_time === 'sv_done') {
        const prev = latestDone.get(a.lead_id)
        if (!prev || a.created_at > prev.created_at) latestDone.set(a.lead_id, a)
      }
    })
    const svScheduledByAgent = new Map()
    const svDoneByAgent = new Map()
    latestScheduled.forEach((a, leadId) => {
      if (statusMap.get(leadId) !== 'sv_scheduled') return
      svScheduledByAgent.set(a.user_id, (svScheduledByAgent.get(a.user_id) || 0) + 1)
    })
    latestDone.forEach((a, leadId) => {
      const rank = STAGE_ORDER.indexOf(statusMap.get(leadId))
      if (rank < SV_DONE_RANK) return
      svDoneByAgent.set(a.user_id, (svDoneByAgent.get(a.user_id) || 0) + 1)
    })

    const computed = (agents || []).map((agent) => {
      const mine = (leads || []).filter((l) => l.assigned_to === agent.id)
      const open = mine.filter((l) => l.status !== 'won' && l.status !== 'lost')
      const uncalled = open.filter((l) => !l.call_status)
      const pendingToday = open.filter((l) => l.call_status && l.next_followup_date && l.next_followup_date <= today)
      const overdue = pendingToday.filter((l) => l.next_followup_date < today)
      const won = mine.filter((l) => l.status === 'won')

      const outcomeCounts = {}
      CALL_OUTCOMES.forEach((o) => {
        outcomeCounts[o.key] = open.filter((l) => l.call_status === o.key).length
      })

      return {
        agent,
        openLeads: open.length,
        uncalled: uncalled.length,
        pendingToday: pendingToday.length,
        overdue: overdue.length,
        svScheduled: svScheduledByAgent.get(agent.id) || 0,
        svDone: svDoneByAgent.get(agent.id) || 0,
        won: won.length,
        outcomeCounts
      }
    })

    setRows(computed)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Lets the pull-down-to-refresh gesture re-run this page's own load().
  useRegisterRefresh(load)

  const sorted = useMemo(() => [...rows].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0)), [rows, sortKey])

  if (profile && !isAdmin) return <Navigate to="/settings" replace />

  function viewAgentLeads(agentId) {
    setPersisted('leads:filters', { stage: '', outcome: '', source: '', agent: agentId })
    navigate('/leads')
  }

  return (
    <div>
      <TopBar title="Team Performance" subtitle="This month — tap an agent to see their leads" />

      <div className="px-4 pb-10">
        {loading && <PageLoader label="Loading team activity…" />}

        {!loading && rows.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">👥</p>
            <p className="font-semibold">No agents yet</p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 -mx-4 px-4">
              {SORT_OPTIONS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setSortKey(c.key)}
                  className={`press flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                    sortKey === c.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {sorted.map((r) => (
                <div key={r.agent.id} className="bg-white rounded-2xl border border-line/60 shadow-card overflow-hidden">
                  <button onClick={() => viewAgentLeads(r.agent.id)} className="press w-full text-left p-4 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-accent/10 text-accent flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {(r.agent.full_name || r.agent.email || '?')[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[15px] truncate">{r.agent.full_name || r.agent.email}</p>
                          {!r.agent.receiving_leads && <p className="text-[11px] text-warning font-medium">Not receiving leads</p>}
                        </div>
                      </div>
                      <span className="text-xs text-muted flex-shrink-0">View leads →</span>
                    </div>
                  </button>

                  {/* Two headline numbers, kept clearly apart on purpose — this
                      is exactly the "new vs follow-ups" split the rest of the
                      app now uses, so it reads the same way here. */}
                  <div className="grid grid-cols-2 gap-2 px-4 pb-3">
                    <div className="rounded-xl bg-base px-3 py-2.5">
                      <p className="text-[20px] font-bold tabular-nums text-ink">{r.uncalled}</p>
                      <p className="text-[11px] text-muted font-medium">New leads pending (uncalled)</p>
                    </div>
                    <div className="rounded-xl bg-base px-3 py-2.5">
                      <p className={`text-[20px] font-bold tabular-nums ${r.overdue > 0 ? 'text-danger' : 'text-ink'}`}>{r.pendingToday}</p>
                      <p className="text-[11px] text-muted font-medium">
                        Follow-ups pending{r.overdue > 0 ? ` (${r.overdue} overdue)` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="px-4 pb-3">
                    <p className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5">Call outcomes (open leads)</p>
                    <div className="grid grid-cols-6 gap-1 text-center">
                      {CALL_OUTCOMES.map((o) => (
                        <div key={o.key}>
                          <p className="text-sm font-bold tabular-nums" style={{ color: o.color }}>
                            {r.outcomeCounts[o.key]}
                          </p>
                          <p className="text-[9px] text-muted font-medium">{o.key}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="px-4 pb-4 pt-3 border-t border-line grid grid-cols-4 gap-2 text-center">
                    <MiniStat value={r.openLeads} label="Open total" />
                    <MiniStat value={r.svScheduled} label="SV Sched." />
                    <MiniStat value={r.svDone} label="SV Done" />
                    <MiniStat value={r.won} label="Won" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MiniStat({ value, label }) {
  return (
    <div>
      <p className="text-[15px] font-bold tabular-nums text-ink">{value}</p>
      <p className="text-[10px] text-muted font-medium mt-0.5">{label}</p>
    </div>
  )
}
