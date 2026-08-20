import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import Sheet from '../components/Sheet.jsx'
import { PageLoader } from '../components/Loader.jsx'
import { usePersistedState } from '../lib/usePersistedState.js'
import { displayPhone, toLocalDateStr, formatDateHuman } from '../lib/helpers.js'
import { STAGES } from '../lib/constants.js'

function startOfWeek(d) {
  const dt = new Date(d)
  const day = dt.getDay() // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day // week starts Monday
  dt.setDate(dt.getDate() + diff)
  return dt
}

// A lead that has moved past "SV Done" (negotiation, login, won…) still
// counts as a completed site visit — it shouldn't drop out of the report
// just because the deal progressed further.
const STAGE_ORDER = STAGES.map((s) => s.key)
const SV_DONE_RANK = STAGE_ORDER.indexOf('sv_done')

export default function SVReport() {
  const { user } = useAuth()
  const [range, setRange] = usePersistedState('svreport:range', 'week') // 'week' | 'month'
  const [anchor, setAnchor] = usePersistedState('svreport:anchor', new Date())
  const [activities, setActivities] = useState([])
  const [leadMap, setLeadMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [openDay, setOpenDay] = useState(null)

  const { rangeStart, rangeEnd, days } = useMemo(() => {
    let start, end
    if (range === 'week') {
      start = startOfWeek(anchor)
      end = new Date(start)
      end.setDate(end.getDate() + 6)
    } else {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    }
    const list = []
    const cur = new Date(start)
    while (cur <= end) {
      list.push(toLocalDateStr(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return { rangeStart: start, rangeEnd: end, days: list }
  }, [range, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    // Fetch broadly and bucket client-side — keeps the query simple and
    // robust; volumes for a single agent's activity log are small.
    const { data: acts } = await supabase
      .from('activities')
      .select('*')
      .eq('user_id', user.id)
      .in('stage_at_time', ['sv_scheduled', 'sv_done'])
      .order('created_at', { ascending: true })
      .limit(3000)

    const leadIds = Array.from(new Set((acts || []).map((a) => a.lead_id)))
    let leads = []
    if (leadIds.length) {
      const { data } = await supabase.from('leads').select('id,name,phone,status').in('id', leadIds)
      leads = data || []
    }

    setActivities(acts || [])
    setLeadMap(new Map(leads.map((l) => [l.id, l])))
    setLoading(false)
  }, [user.id])

  useEffect(() => {
    load()
  }, [load])

  // Counting is per LEAD, not per call/activity row, and only counts a
  // lead while its live status still backs up the mark — if the SV
  // Scheduled tag gets changed or undone later, it disappears from here
  // too instead of lingering as a stale historical row.
  const { byDay, totals } = useMemo(() => {
    const map = {}
    days.forEach((d) => (map[d] = { scheduled: [], done: [] }))

    // Latest activity of each stage, per lead (acts are ascending, so the
    // last one wins).
    const latestScheduled = new Map()
    const latestDone = new Map()
    activities.forEach((a) => {
      if (a.stage_at_time === 'sv_scheduled') latestScheduled.set(a.lead_id, a)
      if (a.stage_at_time === 'sv_done') latestDone.set(a.lead_id, a)
    })

    latestScheduled.forEach((a, leadId) => {
      const lead = leadMap.get(leadId)
      if (!lead || lead.status !== 'sv_scheduled') return // mark was changed/undone since
      const d = a.followup_date
      if (d && map[d]) map[d].scheduled.push(lead)
    })

    latestDone.forEach((a, leadId) => {
      const lead = leadMap.get(leadId)
      if (!lead) return
      const rank = STAGE_ORDER.indexOf(lead.status)
      if (rank < SV_DONE_RANK) return // reverted back before SV Done — mark no longer counts
      const d = toLocalDateStr(a.created_at)
      if (map[d]) map[d].done.push(lead)
    })

    let scheduled = 0,
      done = 0
    Object.values(map).forEach((v) => {
      scheduled += v.scheduled.length
      done += v.done.length
    })
    return { byDay: map, totals: { scheduled, done } }
  }, [activities, leadMap, days])

  function shift(delta) {
    const d = new Date(anchor)
    if (range === 'week') d.setDate(d.getDate() + delta * 7)
    else d.setMonth(d.getMonth() + delta)
    setAnchor(d)
  }

  const label =
    range === 'week'
      ? `${formatDateHuman(toLocalDateStr(rangeStart))} – ${formatDateHuman(toLocalDateStr(rangeEnd))}`
      : anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const openDayData = openDay ? byDay[openDay] : null

  return (
    <div>
      <TopBar title="Site Visit Report" subtitle="Scheduled vs. completed — by lead" />

      <div className="px-4 flex items-center gap-2 mb-3">
        <div className="flex bg-white rounded-full border border-line p-0.5">
          <button onClick={() => setRange('week')} className={`press px-3 py-1.5 rounded-full text-xs font-semibold ${range === 'week' ? 'bg-ink text-white' : 'text-muted'}`}>
            Week
          </button>
          <button onClick={() => setRange('month')} className={`press px-3 py-1.5 rounded-full text-xs font-semibold ${range === 'month' ? 'bg-ink text-white' : 'text-muted'}`}>
            Month
          </button>
        </div>
        <button onClick={() => shift(-1)} className="press h-8 w-8 rounded-full bg-white border border-line text-sm">
          ‹
        </button>
        <p className="text-xs font-semibold text-muted flex-1 text-center">{label}</p>
        <button onClick={() => shift(1)} className="press h-8 w-8 rounded-full bg-white border border-line text-sm">
          ›
        </button>
      </div>

      <div className="px-4 grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
          <p className="text-[28px] font-bold text-purple leading-none">{totals.scheduled}</p>
          <p className="text-xs text-muted font-medium mt-1.5">SV Scheduled</p>
        </div>
        <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
          <p className="text-[28px] font-bold text-teal leading-none">{totals.done}</p>
          <p className="text-xs text-muted font-medium mt-1.5">SV Done</p>
          <p className="text-[10px] text-muted mt-0.5">
            {totals.scheduled ? `${Math.round((totals.done / totals.scheduled) * 100)}% completion` : '—'}
          </p>
        </div>
      </div>

      <div className="px-4 pb-8">
        {loading && <PageLoader label="Loading site visits…" />}
        {!loading && (
          <div className="bg-white rounded-2xl border border-line/60 shadow-card divide-y divide-line overflow-hidden">
            {days.map((d) => {
              const v = byDay[d]
              const isToday = d === toLocalDateStr(new Date())
              const hasData = v.scheduled.length > 0 || v.done.length > 0
              if (!hasData && range === 'month') return null
              return (
                <button
                  key={d}
                  onClick={() => hasData && setOpenDay(d)}
                  className={`press w-full flex items-center justify-between px-4 py-3 text-left ${isToday ? 'bg-accent/5' : ''} ${!hasData ? 'opacity-60' : ''}`}
                  disabled={!hasData}
                >
                  <span className={`text-sm ${isToday ? 'font-semibold text-accent' : ''}`}>{formatDateHuman(d)}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-purple font-semibold">{v.scheduled.length} sched.</span>
                    <span className="text-teal font-semibold">{v.done.length} done</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <Sheet open={!!openDay} onClose={() => setOpenDay(null)} title={openDay ? formatDateHuman(openDay) : ''}>
        {openDayData && (
          <div className="space-y-5">
            {openDayData.scheduled.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2 text-purple">SV Scheduled ({openDayData.scheduled.length})</p>
                <div className="space-y-2">
                  {openDayData.scheduled.map((l) => (
                    <LeadRow key={l.id} lead={l} />
                  ))}
                </div>
              </div>
            )}
            {openDayData.done.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2 text-teal">SV Done ({openDayData.done.length})</p>
                <div className="space-y-2">
                  {openDayData.done.map((l) => (
                    <LeadRow key={l.id} lead={l} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function LeadRow({ lead }) {
  return (
    <Link
      to={`/leads/${lead.id}`}
      className="press flex items-center justify-between bg-base rounded-xl border border-line px-3.5 py-3"
    >
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{lead.name}</p>
        <p className="text-xs text-muted">{displayPhone(lead.phone)}</p>
      </div>
      <span className="text-xs text-muted">View →</span>
    </Link>
  )
}
