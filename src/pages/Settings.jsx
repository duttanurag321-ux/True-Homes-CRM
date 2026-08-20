import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import TopBar from '../components/TopBar.jsx'
import { IconFire, IconInbox } from '../components/Icons.jsx'

export default function Settings() {
  const { user, profile, signOut } = useAuth()
  const [totals, setTotals] = useState(null)
  const [agents, setAgents] = useState(null)
  const [svTarget, setSvTarget] = useState(null)
  const [svTargetInput, setSvTargetInput] = useState('')
  const [savingTarget, setSavingTarget] = useState(false)
  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (!user) return
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', user.id)
      .then(({ count }) => setTotals((t) => ({ ...t, leads: count || 0 })))
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', user.id)
      .eq('status', 'won')
      .then(({ count }) => setTotals((t) => ({ ...t, won: count || 0 })))
  }, [user])

  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from('profiles')
      .select('id,full_name,email,receiving_leads')
      .eq('role', 'agent')
      .order('full_name')
      .then(({ data }) => setAgents(data || []))
    supabase
      .from('app_settings')
      .select('sv_monthly_target')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        setSvTarget(data?.sv_monthly_target ?? 12)
        setSvTargetInput(String(data?.sv_monthly_target ?? 12))
      })
  }, [isAdmin])

  async function saveSvTarget() {
    const n = parseInt(svTargetInput, 10)
    if (!Number.isFinite(n) || n <= 0) return
    setSavingTarget(true)
    const { error } = await supabase.from('app_settings').update({ sv_monthly_target: n, updated_at: new Date().toISOString() }).eq('id', 1)
    setSavingTarget(false)
    if (!error) setSvTarget(n)
  }

  async function toggleReceiving(agent) {
    const next = !agent.receiving_leads
    setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, receiving_leads: next } : a)))
    const { error } = await supabase.from('profiles').update({ receiving_leads: next }).eq('id', agent.id)
    if (error) {
      // Revert on failure — keeps the toggle honest instead of showing a
      // state that didn't actually save.
      setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, receiving_leads: !next } : a)))
    }
  }

  return (
    <div>
      <TopBar title="Settings" />

      <div className="px-4 space-y-4">
        <div className="bg-white rounded-2xl border border-line/60 shadow-card p-5 flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-accent flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
            {(profile?.full_name || user?.email || '?')[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[16px] truncate">{profile?.full_name || 'Agent'}</p>
            <p className="text-sm text-muted truncate">{user?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total leads" value={totals?.leads ?? '—'} />
          <Stat label="Deals won" value={totals?.won ?? '—'} />
          <Stat
            label="Streak"
            value={
              <span className="flex items-center gap-1 justify-center text-warning">
                <IconFire size={16} /> {profile?.streak_count || 0}
              </span>
            }
          />
        </div>

        <div className="bg-white rounded-2xl border border-line/60 shadow-card divide-y divide-line overflow-hidden">
          <SettingsRow label="Full name" value={profile?.full_name || '—'} />
          <SettingsRow label="Role" value={profile?.role === 'admin' ? 'Admin' : 'Agent'} />
        </div>

        {isAdmin && (
          <>
            <Link
              to="/leads/pool"
              className="press flex items-center justify-between bg-white rounded-2xl border border-line/60 shadow-card p-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-accent/10 text-accent flex items-center justify-center">
                  <IconInbox size={18} />
                </div>
                <div>
                  <p className="font-semibold text-sm">Lead Pool</p>
                  <p className="text-xs text-muted">Unassigned leads waiting to be distributed</p>
                </div>
              </div>
              <span className="text-muted">→</span>
            </Link>

            <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
              <p className="text-sm font-semibold mb-1">Monthly Site Visit target</p>
              <p className="text-xs text-muted mb-3">
                Used for the Site Visit progress ring on the Home screen. Applies team-wide.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={svTargetInput}
                  onChange={(e) => setSvTargetInput(e.target.value)}
                  className="w-24 rounded-xl border border-line px-3 py-2 text-sm bg-base"
                />
                <button
                  onClick={saveSvTarget}
                  disabled={savingTarget || String(svTarget) === svTargetInput}
                  className="press px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-50"
                >
                  {savingTarget ? 'Saving…' : 'Save'}
                </button>
                {svTarget !== null && String(svTarget) === svTargetInput && (
                  <span className="text-xs text-success font-medium">Current: {svTarget}/month</span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
              <p className="text-sm font-semibold mb-1">Team — Receiving Leads</p>
              <p className="text-xs text-muted mb-3">
                Turn an agent off to skip them in Round Robin without removing them — useful if they're on leave.
              </p>
              <div className="divide-y divide-line">
                {agents === null && <p className="text-sm text-muted py-2">Loading team…</p>}
                {agents?.length === 0 && <p className="text-sm text-muted py-2">No agents yet.</p>}
                {agents?.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-3">
                    <span className="text-sm font-medium truncate">{a.full_name || a.email}</span>
                    <button
                      onClick={() => toggleReceiving(a)}
                      className={`press relative h-6 w-11 rounded-full transition-colors flex-shrink-0 ${
                        a.receiving_leads ? 'bg-success' : 'bg-line'
                      }`}
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          a.receiving_leads ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
          <p className="text-sm font-semibold mb-1">Adding teammates</p>
          <p className="text-xs text-muted leading-relaxed">
            New agents create their own account from the sign-in screen. To make someone an admin (able to see all
            leads, not just their own), update their role in the Supabase Table Editor under the{' '}
            <code className="bg-base px-1 rounded">profiles</code> table.
          </p>
        </div>

        <button onClick={signOut} className="press w-full py-3.5 rounded-xl bg-white border border-line text-danger font-semibold">
          Sign out
        </button>

        <p className="text-center text-xs text-muted pb-6">True Homes · your dream home comes true</p>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-line/60 shadow-card p-3.5 text-center">
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] text-muted font-medium mt-1">{label}</p>
    </div>
  )
}

function SettingsRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
