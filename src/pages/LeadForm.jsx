import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import { LEAD_SOURCES, SQFT_PER_KATHA } from '../lib/constants.js'
import { normalizeIndianPhone } from '../lib/helpers.js'

const empty = {
  name: '',
  phone: '',
  source: LEAD_SOURCES[0],
  profession: '',
  budget_max: '',
  sqft: '',
  katha: '',
  location_preference: '',
  notes: '',
  next_action: '',
  next_followup_date: '',
  next_followup_time: ''
}

export default function LeadForm() {
  const { id } = useParams()
  const editing = !!id
  const navigate = useNavigate()
  const { user } = useAuth()
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing) return
    supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (data) setForm({ ...empty, ...data })
      })
  }, [id, editing])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  // Plot size fields auto-convert both ways — 1 katha = 720 sq ft.
  function setSqft(value) {
    setForm((f) => ({
      ...f,
      sqft: value,
      katha: value === '' ? '' : (Number(value) / SQFT_PER_KATHA).toFixed(2).replace(/\.?0+$/, '')
    }))
  }
  function setKatha(value) {
    setForm((f) => ({
      ...f,
      katha: value,
      sqft: value === '' ? '' : Math.round(Number(value) * SQFT_PER_KATHA)
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) return setError('Name is required.')
    if (!form.phone.trim()) return setError('Phone number is required.')
    // A brand-new, never-called lead deliberately gets NO follow-up date —
    // it sits in "New Leads" until the first call is logged, instead of
    // auto-appearing in Today's follow-up list on day one. Editing an
    // already-contacted lead still needs a valid date, same as before.
    if (editing && !form.next_followup_date) return setError('A follow-up date is required.')

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        phone: normalizeIndianPhone(form.phone),
        source: form.source,
        profession: form.profession || null,
        budget_max: form.budget_max || null,
        sqft: form.sqft || null,
        katha: form.katha || null,
        location_preference: form.location_preference || null,
        notes: form.notes || null,
        next_action: editing ? form.next_action || null : null,
        next_followup_date: editing ? form.next_followup_date || null : null,
        next_followup_time: editing ? form.next_followup_time || null : null
      }

      if (editing) {
        const { error } = await supabase.from('leads').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
        navigate(`/leads/${id}`)
      } else {
        const { data, error } = await supabase
          .from('leads')
          .insert({ ...payload, status: 'new', created_by: user.id, assigned_to: user.id })
          .select()
          .single()
        if (error) throw error
        navigate(`/leads/${data.id}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <TopBar title={editing ? 'Edit Lead' : 'New Lead'} back />
      <form onSubmit={handleSubmit} className="px-4 mt-2 space-y-4 pb-10">
        <Field label="Name">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} className="input" placeholder="Full name" />
        </Field>
        <Field label="Phone (India)">
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className="input" placeholder="98765 43210" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <select value={form.source} onChange={(e) => set('source', e.target.value)} className="input">
              {LEAD_SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Profession (optional)">
            <input value={form.profession} onChange={(e) => set('profession', e.target.value)} className="input" placeholder="e.g. Businessman" />
          </Field>
        </div>

        <Field label="Budget (₹, optional)">
          <input type="number" value={form.budget_max} onChange={(e) => set('budget_max', e.target.value)} className="input" placeholder="e.g. 5500000" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Sqft (optional)">
            <input type="number" value={form.sqft} onChange={(e) => setSqft(e.target.value)} className="input" placeholder="e.g. 1440" />
          </Field>
          <Field label="Katha (optional)">
            <input type="number" step="0.01" value={form.katha} onChange={(e) => setKatha(e.target.value)} className="input" placeholder="e.g. 2" />
          </Field>
        </div>
        <p className="text-[11px] text-muted -mt-2">1 katha = 720 sqft — fill either one, the other fills itself.</p>

        <Field label="Lead's location — city/area (optional for a fresh cold lead)">
          <input value={form.location_preference} onChange={(e) => set('location_preference', e.target.value)} className="input" placeholder="e.g. Sevoke Road, Siliguri" />
        </Field>
        <p className="text-[11px] text-muted -mt-2">
          Fine to leave blank right now — you'll be asked for it when you log the first call if it's still empty.
        </p>

        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="input" placeholder="Anything relevant about this lead" />
        </Field>

        {editing && (
          <div className="bg-white rounded-2xl border border-line p-4">
            <p className="text-sm font-semibold mb-3">Next follow-up</p>
            <Field label="Next action">
              <input value={form.next_action} onChange={(e) => set('next_action', e.target.value)} className="input" />
            </Field>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Date">
                <input type="date" value={form.next_followup_date} onChange={(e) => set('next_followup_date', e.target.value)} className="input" />
              </Field>
              <Field label="Time (optional)">
                <input type="time" value={form.next_followup_time} onChange={(e) => set('next_followup_time', e.target.value)} className="input" />
              </Field>
            </div>
          </div>
        )}

        {!editing && (
          <p className="text-[11px] text-muted -mt-2">
            This lead will sit in <strong>New Leads</strong> — it won't show up as a follow-up until you log the first call.
          </p>
        )}

        {error && <p className="text-sm text-danger font-medium">{error}</p>}

        <button type="submit" disabled={saving} className="press w-full py-3.5 rounded-xl bg-accent text-white font-semibold disabled:opacity-50">
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add lead'}
        </button>
      </form>

      <style>{`.input { width:100%; border-radius: 0.75rem; border: 1px solid #E5E5EA; padding: 0.65rem 0.85rem; font-size: 0.9rem; background: #F5F5F7; }`}</style>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}
