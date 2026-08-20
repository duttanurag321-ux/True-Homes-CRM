import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import RingProgress from './RingProgress.jsx'
import { PageLoader } from './Loader.jsx'
import { IconFire, IconInbox } from './Icons.jsx'
import { todayStr, localDayBoundsUTC, localMonthBoundsUTC, formatTime } from '../lib/helpers.js'
import { STAGES } from '../lib/constants.js'

const STAGE_ORDER = STAGES.map((s) => s.key)
const SV_DONE_RANK = STAGE_ORDER.indexOf('sv_done')

export default function HomeDashboard() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const today = todayStr()
    const { startISO: dayStart, endISO: dayEnd } = localDayBoundsUTC(today)
    const { startISO: monthStart, endISO: monthEnd, label: monthLabel } = localMonthBoundsUTC()

    const scopeLead = (q) => (isAdmin ? q : q.eq('assigned_to', user.id))
    const scopeActivity = (q) => (isAdmin ? q : q.eq('user_id', user.id))

    const [
      { data: settingsRow },
      { count: newLeadsToday },
      { count: newLeadsMonth },
      { data: scheduledTodayRows },
      { count: unassignedCount },
      { count: hotCount },
      { count: uncalledCount },
      { data: monthActs }
    ] = await Promise.all([
      supabase.from('app_settings').select('sv_monthly_target').eq('id', 1).maybeSingle(),
      scopeLead(supabase.from('leads').select('id', { count: 'exact', head: true })).gte('created_at', dayStart).lte('created_at', dayEnd),
      scopeLead(supabase.from('leads').select('id', { count: 'exact', head: true })).gte('created_at', monthStart).lte('created_at', monthEnd),
      scopeLead(supabase.from('leads').select('id,name,next_followup_time')).eq('status', 'sv_scheduled').eq('next_followup_date', today),
      isAdmin
        ? supabase.from('leads').select('id', { count: 'exact', head: true }).is('assigned_to', null)
        : Promise.resolve({ count: 0 }),
      scopeLead(supabase.from('leads').select('id', { count: 'exact', head: true })).eq('call_status', 'IN').not('status', 'in', '("won","lost")'),
      // Backlog of never-called leads — distinct from "New Leads Today"
      // (which is about when they arrived), this is what the Home
      // screen's "New Leads" tab is showing right now.
      scopeLead(supabase.from('leads').select('id', { count: 'exact', head: true })).is('call_status', null).not('status', 'in', '("won","lost")'),
      scopeActivity(supabase.from('activities').select('lead_id,stage_at_time,created_at'))
        .in('stage_at_time', ['sv_done', 'won'])
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd)
    ])

    // Cross-check every "sv_done"/"won" activity against the lead's
    // CURRENT status — exactly the same rule the SV Report uses — so a
    // lead moved back out of SV Done (or out of Won) stops counting
    // instead of leaving a stale historical tick on the ring.
    const leadIds = Array.from(new Set((monthActs || []).map((a) => a.lead_id)))
    let statusMap = new Map()
    if (leadIds.length) {
      const { data: currentLeads } = await supabase.from('leads').select('id,status').in('id', leadIds)
      statusMap = new Map((currentLeads || []).map((l) => [l.id, l.status]))
    }

    const latestSvDone = new Map()
    const latestWon = new Map()
    ;(monthActs || []).forEach((a) => {
      if (a.stage_at_time === 'sv_done') {
        const prev = latestSvDone.get(a.lead_id)
        if (!prev || a.created_at > prev.created_at) latestSvDone.set(a.lead_id, a)
      }
      if (a.stage_at_time === 'won') {
        const prev = latestWon.get(a.lead_id)
        if (!prev || a.created_at > prev.created_at) latestWon.set(a.lead_id, a)
      }
    })

    let monthlySvDone = 0
    let todaySvDone = 0
    latestSvDone.forEach((a, leadId) => {
      const rank = STAGE_ORDER.indexOf(statusMap.get(leadId))
      if (rank < SV_DONE_RANK) return // reverted since — doesn't count, and never double-counted either
      monthlySvDone++
      if (a.created_at >= dayStart && a.created_at <= dayEnd) todaySvDone++
    })

    let monthlyWon = 0
    latestWon.forEach((a, leadId) => {
      if (statusMap.get(leadId) !== 'won') return
      monthlyWon++
    })

    const scheduledToday = (scheduledTodayRows || []).slice().sort((a, b) => {
      if (!a.next_followup_time && !b.next_followup_time) return 0
      if (!a.next_followup_time) return 1
      if (!b.next_followup_time) return -1
      return a.next_followup_time.localeCompare(b.next_followup_time)
    })

    setData({
      svTarget: settingsRow?.sv_monthly_target || 12,
      monthLabel,
      monthlySvDone,
      todaySvDone,
      scheduledToday,
      newLeadsToday: newLeadsToday || 0,
      unassignedCount: unassignedCount || 0,
      hotCount: hotCount || 0,
      uncalledCount: uncalledCount || 0,
      leadToSvRate: newLeadsMonth ? Math.round((monthlySvDone / newLeadsMonth) * 100) : null,
      svToBookingRate: monthlySvDone ? Math.round((monthlyWon / monthlySvDone) * 100) : null
    })
    setLoading(false)
  }, [user.id, isAdmin])

  useEffect(() => {
    load()
  }, [load])

  // Site Visit completion is driven entirely by the existing Pipeline
  // stage change (in FollowUpSheet) — this just listens for it so the
  // ring updates live instead of only on next page load.
  useEffect(() => {
    const channel = supabase
      .channel(`home-dashboard-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user.id, load])

  if (loading || !data) return <PageLoader compact label="Loading your day…" />

  const pct = data.svTarget ? Math.min(100, Math.round((data.monthlySvDone / data.svTarget) * 100)) : 0
  const remainingTarget = Math.max(data.svTarget - data.monthlySvDone, 0)
  const remainingToday = Math.max(data.scheduledToday.length - data.todaySvDone, 0)

  return (
    <div className="px-4 mt-2 space-y-3">
      {/* Hero: monthly Site Visit progress — the one number that matters most */}
      <div className="bg-white rounded-2xl shadow-card border border-line/60 p-5 flex items-center gap-5">
        <RingProgress done={data.monthlySvDone} total={data.svTarget} size={112} stroke={12} color="#30B0C7" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{data.monthLabel}</p>
          <p className="font-semibold text-[17px] mt-0.5">Site Visits</p>
          <p className="text-2xl font-bold tabular-nums mt-0.5">
            {data.monthlySvDone}
            <span className="text-sm text-muted font-medium"> / {data.svTarget}</span>
          </p>
          <p className="text-xs text-muted mt-0.5">
            {pct}% · {remainingTarget === 0 ? 'target reached 🎉' : `${remainingTarget} remaining`}
          </p>
        </div>
      </div>

      {/* Today's Site Visits */}
      <div className="bg-white rounded-2xl shadow-card border border-line/60 p-4">
        <p className="text-sm font-semibold mb-3">Today's Site Visits</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <MiniStat value={data.scheduledToday.length} label="Scheduled" />
          <MiniStat value={data.todaySvDone} label="Completed" color="#34C759" />
          <MiniStat value={remainingToday} label="Remaining" />
        </div>
        {data.scheduledToday.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line space-y-2">
            {data.scheduledToday.map((l) => (
              <Link key={l.id} to={`/leads/${l.id}`} className="press flex items-center justify-between text-sm">
                <span className="font-medium truncate">{l.name}</span>
                <span className="text-xs text-muted flex-shrink-0 ml-2">
                  {l.next_followup_time ? formatTime(l.next_followup_time) : 'Time not specified'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Secondary metrics — smaller, supporting */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Leads to Call" value={data.uncalledCount} hint="Never contacted yet" />
        <StatTile label="New Leads Today" value={data.newLeadsToday} />
        <StatTile
          label="Hot Leads"
          value={data.hotCount}
          icon={<IconFire size={13} className="text-warning" />}
          hint="Marked Interested"
        />
        {isAdmin && (
          <Link to="/leads/pool" className="press">
            <StatTile label="Unassigned Leads" value={data.unassignedCount} icon={<IconInbox size={13} className="text-accent" />} />
          </Link>
        )}
        {(data.leadToSvRate !== null || data.svToBookingRate !== null) && (
          <div className={`bg-white rounded-2xl border border-line/60 shadow-card p-3.5 ${isAdmin ? '' : 'col-span-2'}`}>
            <p className="text-[10px] font-medium text-muted uppercase tracking-wide mb-1.5">Conversion (this month)</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Lead → SV</span>
              <span className="font-semibold">{data.leadToSvRate === null ? '—' : `${data.leadToSvRate}%`}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted">SV → Booking</span>
              <span className="font-semibold">{data.svToBookingRate === null ? '—' : `${data.svToBookingRate}%`}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ value, label, color }) {
  return (
    <div>
      <p className="text-xl font-bold tabular-nums" style={color ? { color } : {}}>
        {value}
      </p>
      <p className="text-[10px] text-muted font-medium mt-0.5">{label}</p>
    </div>
  )
}

function StatTile({ label, value, icon, hint }) {
  return (
    <div className="bg-white rounded-2xl border border-line/60 shadow-card p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[10px] text-muted mt-0.5">{hint}</p>}
    </div>
  )
}
