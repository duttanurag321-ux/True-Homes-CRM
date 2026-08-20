import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import { PageLoader } from '../components/Loader.jsx'
import { CALL_OUTCOMES } from '../lib/constants.js'
import { usePersistedState } from '../lib/usePersistedState.js'
import { todayStr, formatDateHuman, localDayBoundsUTC } from '../lib/helpers.js'
import { IconReports } from '../components/Icons.jsx'

export default function DailyReport() {
  const { user, profile } = useAuth()
  const [date, setDate] = usePersistedState('dailyreport:date', todayStr())
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const isAdmin = profile?.role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    const { startISO, endISO } = localDayBoundsUTC(date)

    let newLeadsQuery = supabase.from('leads').select('id,origin,assigned_to').gte('created_at', startISO).lte('created_at', endISO)
    // Agents only ever see their own book (RLS enforces this anyway) —
    // admins see the whole day's intake across everyone, which is what
    // makes the Facebook/Manual/Assigned/Unassigned breakdown meaningful.
    if (!isAdmin) newLeadsQuery = newLeadsQuery.eq('assigned_to', user.id)

    const [{ data: acts }, { data: newLeads }] = await Promise.all([
      supabase
        .from('activities')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('created_at', { ascending: true }),
      newLeadsQuery
    ])

    const calls = (acts || []).filter((a) => a.type === 'call')

    // A lead called 2-3 times in one day should count once, with its
    // latest outcome for the day — the report reflects leads, not calls.
    const latestPerLead = new Map()
    calls.forEach((a) => latestPerLead.set(a.lead_id, a)) // acts sorted ascending, so last write wins = latest

    const outcomeCounts = {}
    CALL_OUTCOMES.forEach((o) => (outcomeCounts[o.key] = 0))
    latestPerLead.forEach((a) => {
      if (a.call_outcome && outcomeCounts[a.call_outcome] !== undefined) outcomeCounts[a.call_outcome]++
    })
    const answered = latestPerLead.size - outcomeCounts.NP - outcomeCounts.NR - outcomeCounts.OFF

    // Pipeline movement must reflect leads, not call log rows — calling the
    // same lead 3 times in a day and marking "SV Scheduled" each time is
    // still ONE lead scheduled, not three. `latestPerLead` already collapses
    // that. It also needs to only count a stage if the lead's CURRENT status
    // still matches — if the mark got changed or undone later, it should
    // drop out of the report instead of lingering forever.
    const leadIds = Array.from(latestPerLead.keys())
    let statusMap = new Map()
    if (leadIds.length) {
      const { data: currentLeads } = await supabase.from('leads').select('id,status').in('id', leadIds)
      statusMap = new Map((currentLeads || []).map((l) => [l.id, l.status]))
    }

    const stageMoves = (key) => {
      let count = 0
      latestPerLead.forEach((a, leadId) => {
        if (a.stage_at_time === key && statusMap.get(leadId) === key) count++
      })
      return count
    }

    setStats({
      totalLeadsContacted: latestPerLead.size,
      answered,
      totalLeads: (newLeads || []).length,
      leadOrigin: {
        facebook: (newLeads || []).filter((l) => l.origin === 'facebook').length,
        app: (newLeads || []).filter((l) => l.origin === 'app').length,
        csv_import: (newLeads || []).filter((l) => l.origin === 'csv_import').length,
        assigned: (newLeads || []).filter((l) => l.assigned_to).length,
        unassigned: (newLeads || []).filter((l) => !l.assigned_to).length
      },
      outcomeCounts,
      svScheduled: stageMoves('sv_scheduled'),
      svDone: stageMoves('sv_done'),
      negoScheduled: stageMoves('negotiation_scheduled'),
      negoDone: stageMoves('negotiation_done'),
      loginProcess: stageMoves('login_process'),
      won: stageMoves('won'),
      lost: stageMoves('lost')
    })
    setLoading(false)
  }, [user.id, date])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <TopBar title="Daily Report" subtitle={formatDateHuman(date)} />

      <div className="px-4 flex items-center gap-2 mb-4">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayStr()} className="rounded-xl border border-line bg-white px-3 py-2 text-sm" />
        <button onClick={() => setDate(todayStr())} className="press text-xs font-semibold text-accent px-2">
          Today
        </button>
        <Link to="/reports/sv" className="press ml-auto text-xs font-semibold text-accent flex items-center gap-1">
          <IconReports size={14} /> SV Report
        </Link>
      </div>

      {loading || !stats ? (
        <PageLoader label="Crunching the numbers…" />
      ) : (
        <div className="px-4 space-y-4 pb-8">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Leads called" value={stats.totalLeadsContacted} color="#0071E3" />
            <Stat
              label="Answered"
              value={stats.answered}
              color="#34C759"
              sub={stats.totalLeadsContacted ? `${Math.round((stats.answered / stats.totalLeadsContacted) * 100)}% connect rate` : null}
            />
            <Stat label="New leads received" value={stats.totalLeads} color="#5E5CE6" />
            <Stat label="Won today" value={stats.won} color="#34C759" />
          </div>

          {isAdmin && stats.totalLeads > 0 && (
            <Section title="New leads breakdown">
              <div className="bg-white rounded-2xl border border-line/60 shadow-card divide-y divide-line">
                <MoveRow label="Facebook Leads" value={stats.leadOrigin.facebook} />
                <MoveRow label="Manual Leads" value={stats.leadOrigin.app} />
                <MoveRow label="Imported Leads" value={stats.leadOrigin.csv_import} />
                <MoveRow label="Assigned" value={stats.leadOrigin.assigned} />
                <MoveRow label="Unassigned (in Lead Pool)" value={stats.leadOrigin.unassigned} />
              </div>
            </Section>
          )}

          <Section title="Leads by outcome">
            <div className="grid grid-cols-3 gap-2">
              {CALL_OUTCOMES.map((o) => (
                <div key={o.key} className="bg-white rounded-xl border border-line/60 py-3 text-center">
                  <p className="text-lg font-bold" style={{ color: o.color }}>
                    {stats.outcomeCounts[o.key]}
                  </p>
                  <p className="text-[10px] text-muted font-medium mt-0.5">{o.key}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Pipeline movement today">
            <div className="bg-white rounded-2xl border border-line/60 shadow-card divide-y divide-line">
              <MoveRow label="SV Scheduled" value={stats.svScheduled} />
              <MoveRow label="SV Done" value={stats.svDone} />
              <MoveRow label="Negotiation Scheduled" value={stats.negoScheduled} />
              <MoveRow label="Negotiation Done" value={stats.negoDone} />
              <MoveRow label="Login Process" value={stats.loginProcess} />
              <MoveRow label="Won" value={stats.won} highlight="success" />
              <MoveRow label="Lost" value={stats.lost} highlight="danger" />
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
      <p className="text-[28px] font-bold leading-none" style={{ color }}>
        {value}
      </p>
      <p className="text-xs text-muted font-medium mt-1.5">{label}</p>
      {sub && <p className="text-[10px] text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-sm font-semibold mb-2">{title}</p>
      {children}
    </div>
  )
}

function MoveRow({ label, value, highlight }) {
  const color = highlight === 'success' ? 'text-success' : highlight === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  )
}
