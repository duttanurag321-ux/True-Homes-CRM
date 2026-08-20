import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import LeadCard from '../components/LeadCard.jsx'
import Sheet from '../components/Sheet.jsx'
import { ListSkeleton } from '../components/Loader.jsx'
import { useLeadsRealtime } from '../lib/useLeadsRealtime.js'
import { usePersistedState } from '../lib/usePersistedState.js'
import { IconPlus, IconUpload, IconSearch, IconFilter, IconInbox } from '../components/Icons.jsx'
import { STAGES, CALL_OUTCOMES, LEAD_SOURCES } from '../lib/constants.js'

const EMPTY_FILTERS = { stage: '', outcome: '', source: '' }

export default function Leads() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [leads, setLeads] = useState([])
  // Persisted (not plain useState) so opening a lead and coming back
  // doesn't wipe out what you'd searched/filtered for — the Leads and
  // Lead Detail pages are siblings in the router, so this component
  // fully remounts on the way back otherwise.
  const [query, setQuery] = usePersistedState('leads:query', '')
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = usePersistedState('leads:filters', EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    // Admins manage the whole team's book here (needed to bulk-delete or
    // review across agents); everyone else still only ever sees their own
    // assigned leads, exactly as before.
    let q = supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (!isAdmin) q = q.eq('assigned_to', user.id)
    const { data } = await q
    setLeads(data || [])
    setLoading(false)
  }, [user.id, isAdmin])

  useEffect(() => {
    load()
  }, [load])

  // Imported leads (or any reassignment) should appear live, not just on
  // next manual refresh.
  useLeadsRealtime(user.id, load)

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const filtered = useMemo(() => {
    let list = leads
    if (filters.stage) {
      list = list.filter((l) => l.status === filters.stage)
    } else if (!selectMode) {
      // Default view keeps closed deals out of the way, same as before —
      // only lifted when the agent explicitly filters for Won/Lost.
      // While selecting for bulk actions (delete, etc.) that hiding gets
      // out of the way too — otherwise a Won/Lost lead can never be
      // selected, so "delete all" quietly leaves it behind forever.
      list = list.filter((l) => l.status !== 'won' && l.status !== 'lost')
    }
    if (filters.outcome) list = list.filter((l) => l.call_status === filters.outcome)
    if (filters.source) list = list.filter((l) => l.source === filters.source)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (l) => l.name?.toLowerCase().includes(q) || l.phone?.includes(q) || l.location_preference?.toLowerCase().includes(q)
      )
    }
    return list
  }, [leads, query, filters])

  function openFilters() {
    setDraftFilters(filters)
    setFilterOpen(true)
  }

  function applyFilters() {
    setFilters(draftFilters)
    setFilterOpen(false)
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setFilterOpen(false)
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v)
    setSelected(new Set())
  }

  function toggleOne(id) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id))
  function toggleAll() {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((l) => l.id)))
  }

  async function deleteSelected() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'} permanently? This can't be undone.`)) return
    const { error } = await supabase.from('leads').delete().in('id', ids)
    if (!error) {
      setSelected(new Set())
      load()
    } else {
      alert('Could not delete — ' + error.message)
    }
  }

  return (
    <div>
      <TopBar
        title="Leads"
        subtitle={`${filtered.length} of ${leads.length}`}
        right={
          <div className="flex gap-2">
            {isAdmin && (
              <button
                onClick={toggleSelectMode}
                className={`press h-10 px-3.5 rounded-full border flex items-center justify-center text-xs font-semibold ${
                  selectMode ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink shadow-card'
                }`}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
            {isAdmin && (
              <Link to="/leads/pool" className="press h-10 w-10 rounded-full bg-white border border-line flex items-center justify-center text-ink shadow-card">
                <IconInbox size={18} />
              </Link>
            )}
            <Link to="/leads/upload" className="press h-10 w-10 rounded-full bg-white border border-line flex items-center justify-center text-ink shadow-card">
              <IconUpload size={18} />
            </Link>
            <Link to="/leads/new" className="press h-10 w-10 rounded-full bg-accent flex items-center justify-center text-white shadow-pop">
              <IconPlus size={20} />
            </Link>
          </div>
        }
      />

      <div className="px-4 mt-2 mb-3 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-xl border border-line px-3 py-2.5">
          <IconSearch size={17} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, location"
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>
        <button
          onClick={openFilters}
          className={`press relative h-10 w-10 flex-shrink-0 rounded-xl border flex items-center justify-center ${
            activeFilterCount > 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink'
          }`}
        >
          <IconFilter size={18} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {activeFilterCount > 0 && (
        <div className="px-4 mb-3 flex items-center gap-1.5 flex-wrap">
          {filters.stage && <FilterChip label={STAGES.find((s) => s.key === filters.stage)?.label} onClear={() => setFilters((f) => ({ ...f, stage: '' }))} />}
          {filters.outcome && <FilterChip label={filters.outcome} onClear={() => setFilters((f) => ({ ...f, outcome: '' }))} />}
          {filters.source && <FilterChip label={filters.source} onClear={() => setFilters((f) => ({ ...f, source: '' }))} />}
          <button onClick={clearFilters} className="press text-xs font-semibold text-accent px-1.5">
            Clear all
          </button>
        </div>
      )}

      {selectMode && filtered.length > 0 && (
        <div className="px-4 mb-3 flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} className="h-4 w-4 rounded" />
            Select all ({filtered.length})
          </label>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-accent">{selected.size} selected</span>
              <button onClick={deleteSelected} className="press px-3 py-1.5 rounded-full bg-danger/10 text-danger text-xs font-semibold">
                Delete
              </button>
            </div>
          )}
        </div>
      )}

      <div className="px-4 space-y-3 pb-4">
        {loading && <ListSkeleton rows={5} />}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">📋</p>
            <p className="font-semibold">{leads.length === 0 ? 'No leads yet' : 'No matches'}</p>
            <p className="text-sm text-muted mt-1">
              {leads.length === 0 ? 'Add your first lead or bulk upload from a sheet.' : 'Try a different search or filter.'}
            </p>
          </div>
        )}
        {filtered.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            selectable={selectMode}
            selected={selected.has(lead.id)}
            onToggleSelect={toggleOne}
          />
        ))}
        {!loading && leads.length > 0 && !filters.stage && (
          <p className="text-center text-[11px] text-muted pt-2 pb-4">Won and Lost leads are kept out of this list — filter by stage to see them.</p>
        )}
      </div>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter leads">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold mb-2">Stage</p>
            <div className="flex flex-wrap gap-1.5">
              <PillOption label="All" active={!draftFilters.stage} onClick={() => setDraftFilters((f) => ({ ...f, stage: '' }))} />
              {STAGES.map((s) => (
                <PillOption
                  key={s.key}
                  label={s.label}
                  active={draftFilters.stage === s.key}
                  onClick={() => setDraftFilters((f) => ({ ...f, stage: s.key }))}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Call outcome</p>
            <div className="flex flex-wrap gap-1.5">
              <PillOption label="All" active={!draftFilters.outcome} onClick={() => setDraftFilters((f) => ({ ...f, outcome: '' }))} />
              {CALL_OUTCOMES.map((o) => (
                <PillOption
                  key={o.key}
                  label={o.key}
                  active={draftFilters.outcome === o.key}
                  onClick={() => setDraftFilters((f) => ({ ...f, outcome: o.key }))}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Source</p>
            <div className="flex flex-wrap gap-1.5">
              <PillOption label="All" active={!draftFilters.source} onClick={() => setDraftFilters((f) => ({ ...f, source: '' }))} />
              {LEAD_SOURCES.map((s) => (
                <PillOption key={s} label={s} active={draftFilters.source === s} onClick={() => setDraftFilters((f) => ({ ...f, source: s }))} />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={clearFilters} className="press flex-1 py-3 rounded-xl bg-base border border-line font-semibold text-sm">
              Clear
            </button>
            <button onClick={applyFilters} className="press flex-1 py-3 rounded-xl bg-accent text-white font-semibold text-sm">
              Show results
            </button>
          </div>
        </div>
      </Sheet>
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

function FilterChip({ label, onClear }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium bg-white border border-line rounded-full pl-2.5 pr-1.5 py-1">
      {label}
      <button onClick={onClear} className="press h-4 w-4 rounded-full bg-line/70 flex items-center justify-center text-[10px]">
        ×
      </button>
    </span>
  )
}
