import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import RingProgress from '../components/RingProgress.jsx'
import LeadCard from '../components/LeadCard.jsx'
import FollowUpSheet from '../components/FollowUpSheet.jsx'
import { ListSkeleton } from '../components/Loader.jsx'
import { usePersistedState } from '../lib/usePersistedState.js'
import { useMidnightRefresh } from '../lib/useMidnightRefresh.js'
import { IconFire } from '../components/Icons.jsx'
import { todayStr, localDayBoundsUTC } from '../lib/helpers.js'
import { LEAD_LIST_COLUMNS } from '../lib/constants.js'
import { useRegisterRefresh } from '../lib/RefreshContext.jsx'

export default function WorkQueue() {
  const { user, profile } = useAuth()
  const [tab, setTab] = usePersistedState('workqueue:tab', 'today') // 'overdue' | 'today' | 'new'
  const [overdueLeads, setOverdueLeads] = useState([])
  const [todayLeads, setTodayLeads] = useState([])
  const [doneLeadIds, setDoneLeadIds] = useState(new Set())
  const [newLeads, setNewLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeLead, setActiveLead] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const today = todayStr()
    const { startISO, endISO } = localDayBoundsUTC(today)

    // Split into two explicit queries — strictly BEFORE today (overdue)
    // and exactly today — instead of one "due" list, so each gets its
    // own clearly-labeled section rather than being blended together.
    const [{ data: overdue }, { data: dueToday }, { data: fresh }, { data: todaysActivities }] = await Promise.all([
      supabase
        .from('leads')
        .select(LEAD_LIST_COLUMNS)
        .eq('assigned_to', user.id)
        .lt('next_followup_date', today)
        .not('call_status', 'is', null)
        .not('status', 'in', '("won","lost")')
        .order('next_followup_date', { ascending: true })
        .order('next_followup_time', { ascending: true, nullsFirst: false }),
      supabase
        .from('leads')
        .select(LEAD_LIST_COLUMNS)
        .eq('assigned_to', user.id)
        .eq('next_followup_date', today)
        .not('call_status', 'is', null)
        .not('status', 'in', '("won","lost")')
        .order('next_followup_time', { ascending: true, nullsFirst: false }),
      // New Leads: never been called (no call outcome logged yet) —
      // completely separate from either follow-up list.
      supabase
        .from('leads')
        .select(LEAD_LIST_COLUMNS)
        .eq('assigned_to', user.id)
        .is('call_status', null)
        .not('status', 'in', '("won","lost")')
        .order('created_at', { ascending: false }),
      supabase.from('activities').select('lead_id').eq('user_id', user.id).gte('created_at', startISO).lte('created_at', endISO)
    ])

    // A lead only counts as "done today" if it was logged today AND its
    // follow-up is no longer due (pushed to a future date, or closed).
    // Cross-checking against the freshly-fetched due sets means a
    // same-day reschedule keeps the lead visible instead of vanishing.
    const dueIds = new Set([...(overdue || []), ...(dueToday || [])].map((l) => l.id))
    const doneToday = new Set((todaysActivities || []).map((a) => a.lead_id).filter((id) => !dueIds.has(id)))

    setOverdueLeads(overdue || [])
    setTodayLeads(dueToday || [])
    setNewLeads(fresh || [])
    setDoneLeadIds(doneToday)
    setLoading(false)
  }, [user.id])

  useEffect(() => {
    load()
  }, [load])

  // Lets the pull-down-to-refresh gesture re-run this page's own load().
  useRegisterRefresh(load)

  // Realtime removed here too — see the note in Leads.jsx. Opening this
  // page or pulling to refresh is responsive enough for 4 users, at
  // zero ongoing connection cost.

  // Right at midnight, today's list needs to become yesterday's overdue
  // list — without this, that only happened the next time the page
  // happened to reload.
  useMidnightRefresh(load)

  const pendingCount = overdueLeads.length + todayLeads.length
  useEffect(() => {
    if (pendingCount === 0 && doneLeadIds.size > 0) {
      updateStreak()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount])

  async function updateStreak() {
    const today = todayStr()
    if (!profile || profile.last_completed_date === today) return
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const newStreak = profile.last_completed_date === yesterday ? (profile.streak_count || 0) + 1 : 1
    await supabase.from('profiles').update({ streak_count: newStreak, last_completed_date: today }).eq('id', user.id)
  }

  const doneToday = doneLeadIds.size
  const total = pendingCount + doneToday

  const TABS = [
    { key: 'overdue', label: 'Overdue', count: overdueLeads.length },
    { key: 'today', label: 'Today', count: todayLeads.length },
    { key: 'new', label: 'New Leads', count: newLeads.length }
  ]

  return (
    <div>
      <TopBar
        title="Work Queue"
        subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
      />

      <div className="px-4 mt-2">
        <div className="bg-white rounded-2xl shadow-card border border-line/60 p-5 flex items-center gap-5">
          <RingProgress done={doneToday} total={Math.max(total, doneToday)} />
          <div className="flex-1">
            {pendingCount === 0 ? (
              <>
                <p className="font-semibold text-[17px]">All clear 🎉</p>
                <p className="text-sm text-muted mt-0.5">Every follow-up for today is logged.</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-[17px]">{pendingCount} to go</p>
                <p className="text-sm text-muted mt-0.5">
                  {overdueLeads.length > 0 ? `${overdueLeads.length} overdue — clear these first.` : 'All due today. Let\u2019s go.'}
                </p>
              </>
            )}
            {profile?.streak_count > 0 && (
              <div className="flex items-center gap-1 mt-2 text-warning text-xs font-semibold">
                <IconFire size={14} />
                {profile.streak_count} day streak
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 mt-4 flex bg-base rounded-full border border-line p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`press flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-white shadow-card text-ink' : 'text-muted'
            } ${t.key === 'overdue' && t.count > 0 && tab !== t.key ? 'text-danger' : ''}`}
          >
            {t.label} {t.count > 0 && `(${t.count})`}
          </button>
        ))}
      </div>

      {tab === 'overdue' && (
        <div className="px-4 mt-4 space-y-3">
          <p className="text-sm font-semibold text-muted px-0.5">Overdue — these were due on an earlier day</p>
          {loading && <ListSkeleton rows={4} />}
          {!loading && overdueLeads.length === 0 && <EmptyState emoji="🎉" title="Nothing overdue" subtitle="You're all caught up." />}
          {overdueLeads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onLogClick={setActiveLead} />
          ))}
        </div>
      )}

      {tab === 'today' && (
        <div className="px-4 mt-4 space-y-3">
          <p className="text-sm font-semibold text-muted px-0.5">Due today</p>
          {loading && <ListSkeleton rows={4} />}
          {!loading && todayLeads.length === 0 && (
            <EmptyState emoji="✅" title="Nothing due today" subtitle="New follow-ups will show up here the moment they're due." />
          )}
          {todayLeads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onLogClick={setActiveLead} />
          ))}
        </div>
      )}

      {tab === 'new' && (
        <div className="px-4 mt-4 space-y-3">
          <p className="text-sm font-semibold text-muted px-0.5">
            Waiting for a first call — they won't show up as a follow-up until then
          </p>
          {loading && <ListSkeleton rows={4} />}
          {!loading && newLeads.length === 0 && (
            <EmptyState emoji="📭" title="No new leads waiting" subtitle="Fresh leads that haven't been called yet will show up here." />
          )}
          {newLeads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onLogClick={setActiveLead} showFollowUp={false} />
          ))}
        </div>
      )}

      <FollowUpSheet lead={activeLead} open={!!activeLead} onClose={() => setActiveLead(null)} onSaved={load} />
    </div>
  )
}

function EmptyState({ emoji, title, subtitle }) {
  return (
    <div className="text-center py-16">
      <p className="text-5xl mb-3">{emoji}</p>
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted mt-1">{subtitle}</p>
    </div>
  )
}
