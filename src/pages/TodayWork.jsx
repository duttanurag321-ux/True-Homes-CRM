import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import RingProgress from '../components/RingProgress.jsx'
import LeadCard from '../components/LeadCard.jsx'
import FollowUpSheet from '../components/FollowUpSheet.jsx'
import { ListSkeleton } from '../components/Loader.jsx'
import { useLeadsRealtime } from '../lib/useLeadsRealtime.js'
import { usePersistedState } from '../lib/usePersistedState.js'
import { IconFire } from '../components/Icons.jsx'
import { todayStr, localDayBoundsUTC } from '../lib/helpers.js'
import HomeDashboard from '../components/HomeDashboard.jsx'

export default function TodayWork() {
  const { user, profile } = useAuth()
  const [tab, setTab] = usePersistedState('todaywork:tab', 'followups') // 'followups' | 'new'
  const [leads, setLeads] = useState([])
  const [doneLeadIds, setDoneLeadIds] = useState(new Set())
  const [newLeads, setNewLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeLead, setActiveLead] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const today = todayStr()
    const { startISO, endISO } = localDayBoundsUTC(today)

    // Follow-ups: leads that have already been called at least once and
    // have a follow-up date due. New leads created after this update
    // never get a follow-up date until the first call, so they wouldn't
    // need this filter — but leads created BEFORE this update may still
    // have an old auto-set "today" date sitting on them despite never
    // being called. `call_status` only ever gets set by logging a call
    // (see FollowUpSheet), so requiring it here is what actually keeps
    // this list and the New Leads list from overlapping on old data.
    const { data: due } = await supabase
      .from('leads')
      .select('*')
      .eq('assigned_to', user.id)
      .lte('next_followup_date', today)
      .not('call_status', 'is', null)
      .not('status', 'in', '("won","lost")')
      .order('next_followup_date', { ascending: true })
      .order('next_followup_time', { ascending: true, nullsFirst: false })

    // New Leads: never been called (no call outcome logged yet) —
    // completely separate from the follow-up queue, exactly what the
    // "New Leads" tab is for.
    const { data: fresh } = await supabase
      .from('leads')
      .select('*')
      .eq('assigned_to', user.id)
      .is('call_status', null)
      .not('status', 'in', '("won","lost")')
      .order('created_at', { ascending: false })

    const { data: todaysActivities } = await supabase
      .from('activities')
      .select('lead_id')
      .eq('user_id', user.id)
      .gte('created_at', startISO)
      .lte('created_at', endISO)

    // A lead only counts as "done today" if it was logged today AND its
    // follow-up is no longer due today (pushed to a future date, or the
    // lead was closed). Previously this checked "any activity today" —
    // which meant logging a call and rescheduling the very same lead for
    // *later today* made it vanish from the list, even though it was
    // still due. Cross-checking against the freshly-fetched `due` set
    // fixes that: a same-day reschedule keeps the lead visible.
    const dueIds = new Set((due || []).map((l) => l.id))
    const doneToday = new Set((todaysActivities || []).map((a) => a.lead_id).filter((id) => !dueIds.has(id)))

    setLeads(due || [])
    setNewLeads(fresh || [])
    setDoneLeadIds(doneToday)
    setLoading(false)
  }, [user.id])

  useEffect(() => {
    load()
  }, [load])

  // A freshly-imported (or reassigned) lead should show up here without
  // the agent having to pull-to-refresh.
  useLeadsRealtime(user.id, load)

  useEffect(() => {
    if (leads.length === 0 && doneLeadIds.size > 0) {
      updateStreak()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads.length])

  async function updateStreak() {
    const today = todayStr()
    if (!profile || profile.last_completed_date === today) return
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const newStreak = profile.last_completed_date === yesterday ? (profile.streak_count || 0) + 1 : 1
    await supabase.from('profiles').update({ streak_count: newStreak, last_completed_date: today }).eq('id', user.id)
  }

  const doneToday = doneLeadIds.size
  // Leads still pending today, minus any that were already logged today
  // (covers the case where a lead's next follow-up got set back to today).
  const pendingLeads = leads.filter((l) => !doneLeadIds.has(l.id))
  const total = pendingLeads.length + doneToday
  const overdueCount = pendingLeads.filter((l) => l.next_followup_date < todayStr()).length

  return (
    <div>
      <TopBar
        title="Today's Work"
        subtitle={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
      />

      <HomeDashboard />

      <div className="px-4 mt-4 flex bg-base rounded-full border border-line p-1">
        <button
          onClick={() => setTab('followups')}
          className={`press flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${
            tab === 'followups' ? 'bg-white shadow-card text-ink' : 'text-muted'
          }`}
        >
          Follow-ups {pendingLeads.length > 0 && `(${pendingLeads.length})`}
        </button>
        <button
          onClick={() => setTab('new')}
          className={`press flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${
            tab === 'new' ? 'bg-white shadow-card text-ink' : 'text-muted'
          }`}
        >
          New Leads {newLeads.length > 0 && `(${newLeads.length})`}
        </button>
      </div>

      {tab === 'followups' && (
        <>
          <div className="px-4 mt-3">
            <div className="bg-white rounded-2xl shadow-card border border-line/60 p-5 flex items-center gap-5">
              <RingProgress done={doneToday} total={Math.max(total, doneToday)} />
              <div className="flex-1">
                {pendingLeads.length === 0 ? (
                  <>
                    <p className="font-semibold text-[17px]">All clear 🎉</p>
                    <p className="text-sm text-muted mt-0.5">Every follow-up for today is logged.</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-[17px]">{pendingLeads.length} to go</p>
                    <p className="text-sm text-muted mt-0.5">
                      {overdueCount > 0 ? `${overdueCount} overdue — clear these first.` : 'All due today. Let\u2019s go.'}
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

          <div className="px-4 mt-5 space-y-3">
            <p className="text-sm font-semibold text-muted px-0.5">Follow-ups due today</p>
            {loading && <ListSkeleton rows={4} />}
            {!loading && pendingLeads.length === 0 && (
              <div className="text-center py-16">
                <p className="text-5xl mb-3">✅</p>
                <p className="font-semibold">Nothing pending right now</p>
                <p className="text-sm text-muted mt-1">New follow-ups will show up here the moment they're due.</p>
              </div>
            )}
            {pendingLeads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onLogClick={setActiveLead} />
            ))}
          </div>
        </>
      )}

      {tab === 'new' && (
        <div className="px-4 mt-4 space-y-3">
          <p className="text-sm font-semibold text-muted px-0.5">
            Leads waiting for a first call — they won't show up as a follow-up until then
          </p>
          {loading && <ListSkeleton rows={4} />}
          {!loading && newLeads.length === 0 && (
            <div className="text-center py-16">
              <p className="text-5xl mb-3">📭</p>
              <p className="font-semibold">No new leads waiting</p>
              <p className="text-sm text-muted mt-1">Fresh leads that haven't been called yet will show up here.</p>
            </div>
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
