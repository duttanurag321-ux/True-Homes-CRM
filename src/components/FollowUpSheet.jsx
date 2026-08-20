import { useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { CALL_OUTCOMES, STAGES, LEAD_PURPOSES } from '../lib/constants.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { todayStr } from '../lib/helpers.js'

const QUICK_NEXT_ACTIONS = [
  'Call again',
  'Send WhatsApp brochure',
  'Confirm site visit',
  'Follow up after SV',
  'Share negotiated price',
  'Awaiting documents'
]

export default function FollowUpSheet({ lead, open, onClose, onSaved }) {
  const { user } = useAuth()
  const [outcome, setOutcome] = useState(null)
  const [stage, setStage] = useState('new')
  const [nextAction, setNextAction] = useState('')
  const [followDate, setFollowDate] = useState(todayStr())
  const [followTime, setFollowTime] = useState('')
  const [notes, setNotes] = useState('')
  const [location, setLocation] = useState('')
  const [purpose, setPurpose] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [locationSkipped, setLocationSkipped] = useState(false)

  // The sheet component stays mounted and gets reused for whichever
  // lead was tapped — without this, the stage/outcome/etc from the
  // previous lead would linger the next time it's opened.
  useEffect(() => {
    if (open && lead) {
      setOutcome(null)
      setStage(lead.status || 'new')
      setNextAction('')
      setFollowDate(todayStr())
      setFollowTime('')
      setNotes('')
      setLocation(lead.location_preference || '')
      setPurpose(lead.purpose || '')
      setLocationSkipped(false)
      setError('')
    }
  }, [open, lead?.id])

  const isFinal = stage === 'won' || stage === 'lost'
  const needsLocation = !lead?.location_preference

  if (!lead) return null

  async function handleSave() {
    setError('')
    if (!outcome) {
      setError('Pick the call outcome first.')
      return
    }
    // Location is asked once, right after the first real conversation —
    // but it's a nudge, not a gate. If they genuinely don't have it yet,
    // the call still gets logged; nothing here should block that.
    if (needsLocation && !location.trim() && !locationSkipped) {
      setError("No location yet — that's fine, but tap Save again to confirm and log the call anyway.")
      setLocationSkipped(true)
      return
    }
    if (!isFinal && (!nextAction.trim() || !followDate)) {
      setError('Every lead needs a next action and a follow-up date — that\'s the one rule.')
      return
    }
    setSaving(true)
    try {
      const { error: actErr } = await supabase.from('activities').insert({
        lead_id: lead.id,
        user_id: user.id,
        type: 'call',
        call_outcome: outcome,
        notes: notes || null,
        next_action: isFinal ? null : nextAction,
        followup_date: isFinal ? null : followDate,
        followup_time: isFinal ? null : followTime || null,
        stage_at_time: stage
      })
      if (actErr) throw actErr

      const { error: leadErr } = await supabase
        .from('leads')
        .update({
          status: stage,
          call_status: outcome,
          location_preference: location.trim() ? location.trim() : lead.location_preference,
          purpose: purpose || lead.purpose || null,
          next_action: isFinal ? null : nextAction,
          next_followup_date: isFinal ? null : followDate,
          next_followup_time: isFinal ? null : followTime || null,
          last_contacted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', lead.id)
      if (leadErr) throw leadErr

      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Log call — ${lead.name}`}>
      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold mb-2">Call outcome</p>
          <div className="grid grid-cols-3 gap-2">
            {CALL_OUTCOMES.map((o) => (
              <button
                key={o.key}
                onClick={() => setOutcome(o.key)}
                className={`press rounded-xl py-2.5 text-xs font-semibold border ${
                  outcome === o.key ? 'text-white border-transparent' : 'border-line text-ink'
                }`}
                style={outcome === o.key ? { backgroundColor: o.color } : {}}
              >
                {o.key}
                <div className="text-[9px] font-normal opacity-80 mt-0.5 leading-tight">{o.label}</div>
              </button>
            ))}
          </div>
        </div>

        {needsLocation && (
          <div>
            <p className="text-sm font-semibold mb-2">Lead's location (city / area)</p>
            <input
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                setLocationSkipped(false)
              }}
              placeholder="e.g. Sevoke Road, Siliguri"
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm bg-base"
            />
            <p className="text-[11px] text-muted mt-1">Where the lead is based — not the property they're looking at. Asked once; leave blank if you don't have it yet.</p>
          </div>
        )}

        <div>
          <p className="text-sm font-semibold mb-2">Purpose (optional)</p>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_PURPOSES.map((p) => (
              <button
                key={p}
                onClick={() => setPurpose(purpose === p ? '' : p)}
                className={`press px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  purpose === p ? 'bg-ink text-white border-ink' : 'bg-base text-ink border-line'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-1">Why they're buying — residential, investment, commercial, etc. Set this once you actually know.</p>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Pipeline stage</p>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-sm bg-base"
          >
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {!isFinal && (
          <>
            <div>
              <p className="text-sm font-semibold mb-2">Next action (required)</p>
              <input
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="e.g. Call again after he checks with wife"
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm bg-base"
              />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {QUICK_NEXT_ACTIONS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setNextAction(a)}
                    className="press text-[11px] px-2.5 py-1 rounded-full bg-base border border-line text-muted"
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-sm font-semibold mb-2">Follow-up date</p>
                <input
                  type="date"
                  value={followDate}
                  onChange={(e) => setFollowDate(e.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2.5 text-sm bg-base"
                />
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Time (optional)</p>
                <input
                  type="time"
                  value={followTime}
                  onChange={(e) => setFollowTime(e.target.value)}
                  className="w-full rounded-xl border border-line px-3 py-2.5 text-sm bg-base"
                />
              </div>
            </div>
          </>
        )}

        <div>
          <p className="text-sm font-semibold mb-2">Notes (optional)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-line px-3 py-2.5 text-sm bg-base"
            placeholder="Anything worth remembering about this call"
          />
        </div>

        {error && <p className="text-sm text-danger font-medium">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="press w-full py-3.5 rounded-xl bg-accent text-white font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save & mark done'}
        </button>
      </div>
    </Sheet>
  )
}
