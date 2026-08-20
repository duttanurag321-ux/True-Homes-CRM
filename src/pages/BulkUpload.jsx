import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/AuthContext.jsx'
import TopBar from '../components/TopBar.jsx'
import { normalizeIndianPhone } from '../lib/helpers.js'

function guessField(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase().trim())
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c))
    if (idx !== -1) return headers[idx]
  }
  return null
}

export default function BulkUpload() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState(null)
  const [headers, setHeaders] = useState([])
  const [sheetUrl, setSheetUrl] = useState('')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState(null) // { toInsert, duplicateCount, invalidCount }
  const [assignMode, setAssignMode] = useState('self') // 'self' | 'unassigned'
  const [result, setResult] = useState(null)

  function handleParsed(data) {
    if (!data.length) {
      setError('No rows found in that file.')
      return
    }
    const hdrs = Object.keys(data[0])
    setHeaders(hdrs)
    setRows(data)
    setMapping({
      name: guessField(hdrs, ['name']),
      phone: guessField(hdrs, ['phone', 'mobile', 'contact']),
      budget_max: guessField(hdrs, ['budget', 'max budget', 'budget_max']),
      sqft: guessField(hdrs, ['sqft', 'sq ft', 'square feet']),
      katha: guessField(hdrs, ['katha']),
      source: guessField(hdrs, ['source']),
      profession: guessField(hdrs, ['profession', 'occupation']),
      location_preference: guessField(hdrs, ['location', 'area', 'preference']),
      notes: guessField(hdrs, ['note', 'remark'])
    })
    setError('')
    setResult(null)
    setPreview(null)
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => handleParsed(res.data)
    })
  }

  async function handleSheetImport() {
    setError('')
    if (!sheetUrl.trim()) return
    let csvUrl = sheetUrl.trim()
    // Convert a normal Google Sheets share link into its CSV export link.
    const m = csvUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (m && !csvUrl.includes('output=csv') && !csvUrl.includes('/pub')) {
      const gid = (csvUrl.match(/gid=([0-9]+)/) || [])[1] || '0'
      csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`
    }
    try {
      const res = await fetch(csvUrl)
      if (!res.ok) throw new Error('Could not fetch that sheet. Make sure sharing is set to "Anyone with the link".')
      const text = await res.text()
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
      handleParsed(parsed.data)
    } catch (e) {
      setError(e.message)
    }
  }

  async function runPreview() {
    if (!mapping?.name || !mapping?.phone) {
      setError('Map at least Name and Phone before importing.')
      return
    }
    setPreviewing(true)
    setError('')
    const mapped = rows
      .map((r) => ({
        name: (r[mapping.name] || '').trim(),
        phone: normalizeIndianPhone(r[mapping.phone] || ''),
        budget_max: mapping.budget_max ? r[mapping.budget_max] || null : null,
        sqft: mapping.sqft ? r[mapping.sqft] || null : null,
        katha: mapping.katha ? r[mapping.katha] || null : null,
        source: mapping.source ? r[mapping.source] || 'Other' : 'Other',
        profession: mapping.profession ? r[mapping.profession] || null : null,
        location_preference: mapping.location_preference ? r[mapping.location_preference] || null : null,
        notes: mapping.notes ? r[mapping.notes] || null : null,
        status: 'new',
        // Imported leads sit idle in "New Leads" — no follow-up date until
        // the first call is actually logged, same as a manually added lead.
        next_action: null,
        next_followup_date: null,
        origin: 'csv_import',
        created_by: user.id,
        assigned_to: assignMode === 'self' ? user.id : null
      }))
      .filter((r) => r.name && r.phone)

    const invalidCount = rows.length - mapped.length

    // Never create a duplicate lead, even on a repeat import — check
    // every mapped phone number (last 10 digits, matching how phone_digits
    // is stored) against what's already in the CRM before inserting.
    const digitsOf = (p) => p.replace(/\D/g, '').slice(-10)
    const digitsList = Array.from(new Set(mapped.map((r) => digitsOf(r.phone)).filter((d) => d.length === 10)))
    let existing = new Set()
    for (let i = 0; i < digitsList.length; i += 200) {
      const chunk = digitsList.slice(i, i + 200)
      const { data, error: qErr } = await supabase.from('leads').select('phone_digits').in('phone_digits', chunk)
      if (qErr) {
        setError(qErr.message)
        setPreviewing(false)
        return
      }
      ;(data || []).forEach((d) => existing.add(d.phone_digits))
    }

    const seenInBatch = new Set()
    const toInsert = []
    let duplicateCount = 0
    mapped.forEach((r) => {
      const d = digitsOf(r.phone)
      if (existing.has(d) || seenInBatch.has(d)) {
        duplicateCount++
        return
      }
      seenInBatch.add(d)
      toInsert.push(r)
    })

    setPreview({ toInsert, duplicateCount, invalidCount })
    setPreviewing(false)
  }

  async function confirmImport() {
    if (!preview?.toInsert?.length) return
    setImporting(true)
    setError('')
    const { error, count } = await supabase.from('leads').insert(preview.toInsert, { count: 'exact' })
    setImporting(false)
    if (error) {
      setError(error.message)
      return
    }
    setResult({ imported: count ?? preview.toInsert.length, skipped: preview.duplicateCount + preview.invalidCount })
    setPreview(null)
  }

  return (
    <div>
      <TopBar title="Bulk Upload" back />

      <div className="px-4 space-y-5 pb-10">
        <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
          <p className="text-sm font-semibold mb-2">Option 1 — Upload a CSV file</p>
          <p className="text-xs text-muted mb-3">Export your Google Sheet as CSV (File → Download → .csv) and upload it here.</p>
          <label className="press block text-center py-3 rounded-xl border-2 border-dashed border-line text-sm font-medium text-accent cursor-pointer">
            Choose CSV file
            <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
          </label>
        </div>

        <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4">
          <p className="text-sm font-semibold mb-2">Option 2 — Paste a Google Sheet link</p>
          <p className="text-xs text-muted mb-3">
            In Google Sheets: Share → "Anyone with the link" → Viewer. Then paste the link here — no download needed.
          </p>
          <div className="flex gap-2">
            <input
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="flex-1 rounded-xl border border-line px-3 py-2.5 text-sm bg-base"
            />
            <button onClick={handleSheetImport} className="press px-4 rounded-xl bg-ink text-white text-sm font-semibold">
              Fetch
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-danger font-medium">{error}</p>}

        {mapping && (
          <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4 space-y-3">
            <p className="text-sm font-semibold">
              Map your columns <span className="text-muted font-normal">— {rows.length} rows found</span>
            </p>
            {[
              ['name', 'Name', true],
              ['phone', 'Phone', true],
              ['source', 'Source', false],
              ['profession', 'Profession', false],
              ['budget_max', 'Budget', false],
              ['sqft', 'Sqft', false],
              ['katha', 'Katha', false],
              ['location_preference', 'Location', false],
              ['notes', 'Notes', false]
            ].map(([key, label, required]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {label} {required && <span className="text-danger">*</span>}
                </span>
                <select
                  value={mapping[key] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value || null }))}
                  className="rounded-lg border border-line px-2 py-1.5 text-xs bg-base max-w-[160px]"
                >
                  <option value="">— skip —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            <div className="pt-1">
              <p className="text-sm font-medium mb-2">Assign these leads to</p>
              <div className="flex gap-2">
                <label
                  className={`flex-1 press text-center py-2.5 rounded-xl border text-sm font-medium cursor-pointer ${
                    assignMode === 'self' ? 'bg-ink text-white border-ink' : 'bg-base border-line'
                  }`}
                >
                  <input type="radio" className="hidden" checked={assignMode === 'self'} onChange={() => setAssignMode('self')} />
                  Myself
                </label>
                <label
                  className={`flex-1 press text-center py-2.5 rounded-xl border text-sm font-medium cursor-pointer ${
                    assignMode === 'unassigned' ? 'bg-ink text-white border-ink' : 'bg-base border-line'
                  }`}
                >
                  <input type="radio" className="hidden" checked={assignMode === 'unassigned'} onChange={() => setAssignMode('unassigned')} />
                  Leave unassigned (Lead Pool)
                </label>
              </div>
            </div>

            {!preview && (
              <button
                onClick={runPreview}
                disabled={previewing}
                className="press w-full py-3 rounded-xl bg-ink text-white font-semibold disabled:opacity-50 mt-2"
              >
                {previewing ? 'Checking for duplicates…' : 'Preview import'}
              </button>
            )}
          </div>
        )}

        {preview && (
          <div className="bg-white rounded-2xl border border-line/60 shadow-card p-4 space-y-3">
            <p className="text-sm font-semibold">Preview</p>
            <div className="flex gap-2 text-xs font-medium">
              <span className="px-2.5 py-1 rounded-full bg-success/10 text-success">{preview.toInsert.length} to import</span>
              {preview.duplicateCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-warning/10 text-warning">{preview.duplicateCount} duplicate, skipped</span>
              )}
              {preview.invalidCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-danger/10 text-danger">{preview.invalidCount} invalid, skipped</span>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-line border border-line rounded-xl">
              {preview.toInsert.slice(0, 50).map((r, i) => (
                <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                  <span className="font-medium truncate">{r.name}</span>
                  <span className="text-muted text-xs">{r.phone}</span>
                </div>
              ))}
              {preview.toInsert.length > 50 && (
                <p className="px-3 py-2 text-xs text-muted">…and {preview.toInsert.length - 50} more</p>
              )}
              {preview.toInsert.length === 0 && <p className="px-3 py-4 text-sm text-muted text-center">Nothing new to import.</p>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPreview(null)}
                className="press flex-1 py-3 rounded-xl bg-base border border-line font-semibold text-sm"
              >
                Back
              </button>
              <button
                onClick={confirmImport}
                disabled={importing || preview.toInsert.length === 0}
                className="press flex-1 py-3 rounded-xl bg-accent text-white font-semibold text-sm disabled:opacity-50"
              >
                {importing ? 'Importing…' : `Import ${preview.toInsert.length} leads`}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="bg-success/10 rounded-2xl p-4 text-center">
            <p className="font-semibold text-success">Imported {result.imported} leads 🎉</p>
            <button onClick={() => navigate('/leads')} className="press text-sm text-accent font-medium mt-2">
              View leads
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
