import { supabase } from './supabase.js'
import { STAGES, CALL_OUTCOMES, LEAD_ORIGIN_MAP } from './constants.js'
import { formatDateHuman, toLocalDateStr } from './helpers.js'

// Builds a two-tab Excel file — a Summary (every count an admin would
// want for analysis or reporting) and a full raw Leads export (for data
// protection / backup) — and triggers a browser download. Runs entirely
// client-side; no server involved, so it always reflects exactly what
// RLS lets the current user see (everything, for an admin).
export async function exportLeadsToExcel() {
  // Loaded on demand, not bundled into the app everyone downloads —
  // this is a fairly large library, and only admins ever use this
  // feature, so there's no reason to ship it to every agent's phone on
  // every visit.
  const XLSX = await import('xlsx')

  const [{ data: leads }, { data: agents }] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id,name,phone,project,status,call_status,source,origin,assigned_to,budget_max,location_preference,purpose,notes,created_at,next_followup_date,next_followup_time,qualified_at,site_visit_at,booking_at'
      )
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,full_name,email')
  ])

  const agentName = new Map((agents || []).map((a) => [a.id, a.full_name || a.email]))
  const rows = leads || []

  // ---- Summary sheet -----------------------------------------------
  const summary = []
  summary.push(['Metric', 'Count'])
  summary.push(['Total leads received', rows.length])
  summary.push([])
  summary.push(['By stage', ''])
  STAGES.forEach((s) => {
    summary.push([s.label, rows.filter((l) => l.status === s.key).length])
  })
  summary.push([])
  summary.push(['By call outcome (most recent call per lead)', ''])
  summary.push(['No calls yet', rows.filter((l) => !l.call_status).length])
  CALL_OUTCOMES.forEach((o) => {
    summary.push([o.label, rows.filter((l) => l.call_status === o.key).length])
  })
  summary.push([])
  summary.push(['By source', ''])
  const originCounts = {}
  rows.forEach((l) => {
    const label = LEAD_ORIGIN_MAP[l.origin]?.label || 'Manually Added'
    originCounts[label] = (originCounts[label] || 0) + 1
  })
  Object.entries(originCounts).forEach(([label, count]) => summary.push([label, count]))
  summary.push([])

  // Per-project performance — with several campaigns running at once,
  // this is the comparison that actually matters: which project's ads
  // are producing leads that convert, not just leads.
  const projects = Array.from(new Set(rows.map((l) => l.project || 'Unspecified'))).sort()
  summary.push(['By project', 'Leads', 'Qualified', 'Site Visits', 'Bookings'])
  projects.forEach((p) => {
    const inProject = rows.filter((l) => (l.project || 'Unspecified') === p)
    summary.push([
      p,
      inProject.length,
      inProject.filter((l) => l.qualified_at).length,
      inProject.filter((l) => l.site_visit_at).length,
      inProject.filter((l) => l.booking_at).length
    ])
  })
  summary.push([])

  summary.push(['Milestones reached', ''])
  summary.push(['Qualified (marked Interested)', rows.filter((l) => l.qualified_at).length])
  summary.push(['Site Visit completed', rows.filter((l) => l.site_visit_at).length])
  summary.push(['Booking (Won)', rows.filter((l) => l.booking_at).length])
  summary.push([])
  summary.push(['Generated', new Date().toLocaleString('en-IN')])

  // ---- Leads sheet ---------------------------------------------------
  const stageLabel = Object.fromEntries(STAGES.map((s) => [s.key, s.label]))
  const outcomeLabel = Object.fromEntries(CALL_OUTCOMES.map((o) => [o.key, o.label]))

  const leadRows = rows.map((l) => ({
    'CRM Lead ID': l.id,
    Project: l.project || 'Unspecified',
    Name: l.name,
    Phone: l.phone,
    Stage: stageLabel[l.status] || l.status,
    'Call Outcome': l.call_status ? outcomeLabel[l.call_status] || l.call_status : 'No calls yet',
    Source: l.source || '',
    Origin: LEAD_ORIGIN_MAP[l.origin]?.label || 'Manually Added',
    Agent: l.assigned_to ? agentName.get(l.assigned_to) || 'Unknown' : 'Unassigned (Lead Pool)',
    Budget: l.budget_max || '',
    Location: l.location_preference || '',
    Purpose: l.purpose || '',
    Notes: l.notes || '',
    'Created On': l.created_at ? formatDateHuman(toLocalDateStr(l.created_at)) : '',
    'Next Follow-up Date': l.next_followup_date || '',
    'Next Follow-up Time': l.next_followup_time || '',
    'Qualified On': l.qualified_at ? formatDateHuman(toLocalDateStr(l.qualified_at)) : '',
    'Site Visit On': l.site_visit_at ? formatDateHuman(toLocalDateStr(l.site_visit_at)) : '',
    'Booking On': l.booking_at ? formatDateHuman(toLocalDateStr(l.booking_at)) : ''
  }))

  const workbook = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.aoa_to_sheet(summary)
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  const leadsSheet = XLSX.utils.json_to_sheet(leadRows)
  leadsSheet['!cols'] = Object.keys(leadRows[0] || {}).map((k) => ({ wch: Math.max(12, Math.min(30, k.length + 4)) }))
  XLSX.utils.book_append_sheet(workbook, leadsSheet, 'Leads')

  const filename = `True-Homes-CRM-export-${toLocalDateStr(new Date())}.xlsx`
  XLSX.writeFile(workbook, filename)

  return { total: rows.length, filename }
}
