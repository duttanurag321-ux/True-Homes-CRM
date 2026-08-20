import { useEffect, useState, useCallback, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import Sheet from '../components/Sheet.jsx'
import { ListSkeleton } from '../components/Loader.jsx'
import { usePersistedState } from '../lib/usePersistedState.js'
import { IconSearch, IconCalendar } from '../components/Icons.jsx'
import { displayPhone, formatDateHuman, formatINRCompact, toLocalDateStr } from '../lib/helpers.js'
import { LEAD_ORIGINS, LEAD_ORIGIN_MAP } from '../lib/constants.js'

export default function LeadPool() {
  const { user, profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = usePersistedState('leadpool:query', '')
  const [originFilter, setOriginFilter] = usePersistedState('leadpool:origin', '')
  const [dateFilter, setDateFilter] = usePersistedState('leadpool:date', '')
  const [selected, setSelected] = useState(new Set())
  const [assignOpen, setAssignOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: pool }, { data: agentRows }] = await Promise.all([
      supabase.from('leads').select('*').is('assigned_to', null).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id,full_name,email,receiving_leads').eq('role', 'agent').order('full_name')
    ])
    setLeads(pool || [])
    setAgents(agentRows || [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Live updates: a lead landing in the pool (e.g. a fresh Facebook
  // import) or leaving it (another admin just assigned it) should show
  // up here without a manual refresh.
  useEffect(() => {
    if (!user?.id || profile?.role !== 'admin') return
    const channel = supabase
      .channel('lead-pool-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user?.id, profile?.role, load])

  // Admin-only page — the RLS policy on `leads` already hides
  // unassigned rows from non-admins (an agent's `assigned_to = auth.uid()`
  // check never matches a null), so a non-admin would just see an empty
  // page. Redirect instead, since an empty "Lead Pool" would be confusing.
  // (Kept after the hooks above so hook order never changes between renders.)
  if (profile && profile.role !== 'admin') return <Navigate to="/leads" replace />

  const filtered = useMemo(() => {
    let list = leads
    if (originFilter) list = list.filter((l) => l.origin === originFilter)
    if (dateFilter) list = list.filter((l) => toLocalDateStr(l.created_at) === dateFilter)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (l) =>
          l.name?.toLowerCase().includes(q) ||
          l.phone?.includes(q) ||
          l.location_preference?.toLowerCase().includes(q) ||
          l.source?.toLowerCase().includes(q)
      )
    }
    return list
  }, [leads, query, originFilter, dateFilter])

  const allSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id))

  function toggleOne(id) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((s) => {
      if (allSelected) return new Set()
      return new Set(filtered.map((l) => l.id))
    })
  }

  async function assignTo(agentId) {
    setAssigning(true)
    const ids = Array.from(selected)
    const { error } = await supabase.from('leads').update({ assigned_to: agentId }).in('id', ids)
    setAssigning(false)
    setAssignOpen(false)
    if (error) {
      setToast('Something went wrong — try again.')
    } else {
      const agentName = agents.find((a) => a.id === agentId)?.full_name || 'the agent'
      setToast(`${ids.length} lead${ids.length === 1 ? '' : 's'} assigned to ${agentName}.`)
      load()
    }
    setTimeout(() => setToast(''), 3000)
  }

  async function assignRoundRobin() {
    setAssigning(true)
    const ids = Array.from(selected)
    let assignedCount = 0
    let skipped = 0
    // One RPC call per lead — `get_next_import_agent()` locks its state
    // row for the duration of each call, so this stays fair even if two
    // admins run a round robin at the same moment.
    for (const id of ids) {
      const { data: agentId, error: rpcErr } = await supabase.rpc('get_next_import_agent')
      if (rpcErr || !agentId) {
        skipped++
        continue
      }
      const { error } = await supabase.from('leads').update({ assigned_to: agentId }).eq('id', id)
      if (!error) assignedCount++
      else skipped++
    }
    setAssigning(false)
    setAssignOpen(false)
    setToast(
      skipped > 0
        ? `${assignedCount} assigned via round robin, ${skipped} skipped — check that at least one agent has "Receiving Leads" on.`
        : `${assignedCount} lead${assignedCount === 1 ? '' : 's'} distributed via round robin.`
    )
    load()
    setTimeout(() => setToast(''), 4000)
  }

  async function deleteSelected() {
    const ids = Array.from(selected)
    if (!confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'} permanently? This can't be undone.`)) return
    const { error } = await supabase.from('leads').delete().in('id', ids)
    if (error) {
      setToast('Could not delete — try again.')
    } else {
      setToast(`${ids.length} lead${ids.length === 1 ? '' : 's'} deleted.`)
      load()
    }
    setTimeout(() => setToast(''), 3000)
  }

  return (
    <div>
      <TopBar title="Lead Pool" subtitle={`${filtered.length} unassigned`} />

      <div className="px-4 mt-2 mb-3 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-xl border border-line px-3 py-2.5">
          <IconSearch size={17} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, location, source"
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>
      </div>

      <div className="px-4 mb-3 flex items-center gap-1.5 flex-wrap">
        <PillOption label="All sources" active={!originFilter} onClick={() => setOriginFilter('')} />
        {LEAD_ORIGINS.map((o) => (
          <PillOption key={o.key} label={o.label} active={originFilter === o.key} onClick={() => setOriginFilter(o.key)} />
        ))}
        <DateFilterField value={dateFilter} onChange={setDateFilter} />
        {dateFilter && (
          <button onClick={() => setDateFilter('')} className="press text-xs font-semibold text-accent">
            Clear date
          </button>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="px-4 mb-3 flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded" />
            Select all ({filtered.length})
          </label>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-accent">{selected.size} selected</span>
              <button
                onClick={() => setAssignOpen(true)}
                className="press px-3 py-1.5 rounded-full bg-ink text-white text-xs font-semibold"
              >
                Assign Selected
              </button>
              <button
                onClick={assignRoundRobin}
                disabled={assigning}
                className="press px-3 py-1.5 rounded-full bg-accent text-white text-xs font-semibold disabled:opacity-50"
              >
                Round Robin
              </button>
              <button
                onClick={deleteSelected}
                className="press px-3 py-1.5 rounded-full bg-danger/10 text-danger text-xs font-semibold"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="mx-4 mb-3 px-3.5 py-2.5 rounded-xl bg-ink text-white text-xs font-medium">{toast}</div>
      )}

      <div className="px-4 space-y-2.5 pb-10">
        {loading && <ListSkeleton rows={5} />}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📥</p>
            <p className="font-semibold">Lead Pool is empty</p>
            <p className="text-sm text-muted mt-1">New leads without an agent assigned will land here.</p>
          </div>
        )}
        {filtered.map((lead) => (
          <PoolRow key={lead.id} lead={lead} checked={selected.has(lead.id)} onToggle={() => toggleOne(lead.id)} />
        ))}
      </div>

      <Sheet open={assignOpen} onClose={() => setAssignOpen(false)} title={`Assign ${selected.size} lead${selected.size === 1 ? '' : 's'}`}>
        <div className="space-y-4">
          <button
            onClick={assignRoundRobin}
            disabled={assigning}
            className="press w-full py-3.5 rounded-xl bg-accent text-white font-semibold text-sm disabled:opacity-50"
          >
            {assigning ? 'Assigning…' : 'Round Robin — split evenly'}
          </button>

          <div>
            <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">Or choose a specific agent</p>
            <div className="space-y-2">
              {agents.length === 0 && <p className="text-sm text-muted">No agents found yet.</p>}
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => assignTo(a.id)}
                  disabled={assigning}
                  className="press w-full flex items-center justify-between bg-base rounded-xl border border-line px-4 py-3 text-left disabled:opacity-50"
                >
                  <span className="text-sm font-medium">{a.full_name || a.email}</span>
                  {!a.receiving_leads && <span className="text-[10px] text-muted">Not receiving (can still assign manually)</span>}
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => setAssignOpen(false)} className="press w-full py-3 rounded-xl bg-base border border-line font-semibold text-sm">
            Leave unassigned
          </button>
        </div>
      </Sheet>
    </div>
  )
}

function DateFilterField({ value, onChange }) {
  // A bare <input type="date"> shows nothing at all on many mobile
  // browsers until it has a value — no placeholder, no calendar icon,
  // just an empty box that looks broken. This draws a normal-looking
  // pill (icon + "Date" or the picked date) and keeps the real date
  // input invisible on top of it purely to catch the tap and open the
  // native picker — so it never looks blank, before or after picking.
  return (
    <div className="relative flex-shrink-0">
      <div className="flex items-center gap-1.5 rounded-full border border-line bg-white pl-2.5 pr-3 py-1.5 text-xs font-medium pointer-events-none">
        <IconCalendar size={13} className="text-muted flex-shrink-0" />
        <span className={value ? 'text-ink' : 'text-muted'}>{value ? formatDateHuman(value) : 'Date'}</span>
      </div>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0"
      />
    </div>
  )
}

function PillOption({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`press px-3 py-1.5 rounded-full text-xs font-semibold border ${
        active ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line'
      }`}
    >
      {label}
    </button>
  )
}

function PoolRow({ lead, checked, onToggle }) {
  const originLabel = LEAD_ORIGIN_MAP[lead.origin]?.label || 'Manually Added'
  return (
    <div className="bg-white rounded-2xl shadow-card border border-line/60 p-4 flex gap-3">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 rounded mt-1 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-[15px] truncate">{lead.name}</p>
            <p className="text-sm text-muted">{displayPhone(lead.phone)}</p>
          </div>
          <span className="text-[10px] font-medium text-muted flex-shrink-0">{formatDateHuman(toLocalDateStr(lead.created_at))}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-base font-medium text-muted">{originLabel}</span>
          {lead.source && <span className="text-[11px] text-muted">{lead.source}</span>}
          {lead.budget_max ? <span className="text-[11px] text-muted font-medium">{formatINRCompact(lead.budget_max)}</span> : null}
        </div>
      </div>
    </div>
  )
}
