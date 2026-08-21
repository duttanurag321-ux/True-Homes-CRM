import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import { PageLoader } from '../components/Loader.jsx'
import { StagePill, OutcomePill } from '../components/Pills.jsx'
import { formatDateHuman, toLocalDateStr } from '../lib/helpers.js'

export default function ActivityLog() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [tab, setTab] = useState('calls') // 'calls' | 'transfers'
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState([])
  const [transfers, setTransfers] = useState([])
  const [agentFilter, setAgentFilter] = useState('')
  const [agents, setAgents] = useState([])
  const [leadNamesMap, setLeadNames] = useState(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: acts }, { data: xfers }, { data: agentRows }, { data: leadRows }] = await Promise.all([
      supabase
        .from('activities')
        .select('id,lead_id,user_id,call_outcome,notes,next_action,stage_at_time,created_at')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('lead_reassignments')
        .select('id,lead_id,from_agent,to_agent,reassigned_by,created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('profiles').select('id,full_name,email').eq('role', 'agent').order('full_name'),
      supabase.from('leads').select('id,name')
    ])
    setActivities(acts || [])
    setTransfers(xfers || [])
    setAgents(agentRows || [])
    setLeadNames(new Map((leadRows || []).map((l) => [l.id, l.name])))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a.full_name || a.email])), [agents])

  const filteredActs = useMemo(
    () => (agentFilter ? activities.filter((a) => a.user_id === agentFilter) : activities),
    [activities, agentFilter]
  )
  const filteredXfers = useMemo(
    () => (agentFilter ? transfers.filter((t) => t.to_agent === agentFilter || t.from_agent === agentFilter) : transfers),
    [transfers, agentFilter]
  )

  if (profile && !isAdmin) return <Navigate to="/settings" replace />

  return (
    <div>
      <TopBar title="Activity Log" subtitle="Every call logged and every lead transferred" />

      <div className="px-4 mt-1 flex bg-base rounded-full border border-line p-1">
        <button
          onClick={() => setTab('calls')}
          className={`press flex-1 py-2 rounded-full text-sm font-semibold ${tab === 'calls' ? 'bg-white shadow-card text-ink' : 'text-muted'}`}
        >
          Calls
        </button>
        <button
          onClick={() => setTab('transfers')}
          className={`press flex-1 py-2 rounded-full text-sm font-semibold ${tab === 'transfers' ? 'bg-white shadow-card text-ink' : 'text-muted'}`}
        >
          Transfers
        </button>
      </div>

      <div className="px-4 mt-3 mb-3 flex gap-1.5 overflow-x-auto -mx-4 px-4">
        <button
          onClick={() => setAgentFilter('')}
          className={`press flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${!agentFilter ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line'}`}
        >
          Everyone
        </button>
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => setAgentFilter(a.id)}
            className={`press flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              agentFilter === a.id ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line'
            }`}
          >
            {a.full_name || a.email}
          </button>
        ))}
      </div>

      <div className="px-4 pb-10 space-y-2.5">
        {loading && <PageLoader label="Loading activity…" />}

        {!loading && tab === 'calls' && filteredActs.length === 0 && <EmptyNote text="No calls logged yet." />}
        {!loading &&
          tab === 'calls' &&
          filteredActs.map((a) => (
            <Link
              key={a.id}
              to={`/leads/${a.lead_id}`}
              className="press block bg-white rounded-2xl border border-line/60 shadow-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{leadNamesMap.get(a.lead_id) || 'Deleted lead'}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {agentMap.get(a.user_id) || 'Unknown agent'} · {formatDateHuman(toLocalDateStr(a.created_at))}
                  </p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  {a.call_outcome && <OutcomePill code={a.call_outcome} />}
                  <StagePill stage={a.stage_at_time} />
                </div>
              </div>
              {a.notes && <p className="text-sm text-muted mt-2 line-clamp-2">{a.notes}</p>}
              {a.next_action && <p className="text-xs text-muted mt-1">Next: {a.next_action}</p>}
            </Link>
          ))}

        {!loading && tab === 'transfers' && filteredXfers.length === 0 && <EmptyNote text="No leads have been transferred yet." />}
        {!loading &&
          tab === 'transfers' &&
          filteredXfers.map((t) => (
            <Link
              key={t.id}
              to={`/leads/${t.lead_id}`}
              className="press block bg-white rounded-2xl border border-line/60 shadow-card p-4"
            >
              <p className="font-semibold text-sm truncate">{leadNamesMap.get(t.lead_id) || 'Deleted lead'}</p>
              <p className="text-xs text-muted mt-1">
                {t.from_agent ? agentMap.get(t.from_agent) || 'Unassigned' : 'Lead Pool'} →{' '}
                <span className="font-medium text-ink">{agentMap.get(t.to_agent) || 'Unknown'}</span>
              </p>
              <p className="text-[11px] text-muted mt-1">
                By {agentMap.get(t.reassigned_by) || 'Admin'} · {formatDateHuman(toLocalDateStr(t.created_at))}
              </p>
            </Link>
          ))}
      </div>
    </div>
  )
}

function EmptyNote({ text }) {
  return (
    <div className="text-center py-16">
      <p className="text-5xl mb-3">🗒️</p>
      <p className="text-sm text-muted">{text}</p>
    </div>
  )
}
