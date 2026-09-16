/**
 * Broker CRM — Automatic Lead Importer
 * ------------------------------------
 * Watches every tab in this Google Sheet (Facebook can drop leads into
 * Sheet1, Sheet2, or several tabs at once depending on which form/ad
 * they came through) and pushes every new row into the Supabase `leads`
 * table as an UNASSIGNED lead in the app's Lead Pool — dedups by phone
 * and Meta Lead ID, and marks each row as imported so it's never
 * processed twice. Assigning leads to agents (specific agent or round
 * robin) happens from the Lead Pool screen in the app itself, not from
 * this script — that way it always uses your current agent list and
 * each agent's "Receiving Leads" toggle.
 *
 * SETUP (one-time)
 * 1. Open your Google Sheet → Extensions → Apps Script.
 * 2. Delete anything in Code.gs and paste this whole file in.
 * 3. Project Settings (gear icon) → Script Properties → add:
 *      SUPABASE_URL              = https://xxxxx.supabase.co
 *      SUPABASE_SERVICE_ROLE_KEY = (Supabase → Project Settings → API → service_role key)
 *    Never put the service_role key anywhere in the sheet, the frontend,
 *    or a public repo — it bypasses all security rules, by design, so
 *    the importer can write leads. Script Properties keeps it private to
 *    this script.
 * 4. If you have a tab that is NOT a lead sheet (e.g. a "Notes" or
 *    "Summary" tab) and you'd rather it be skipped outright instead of
 *    just being silently ignored (see how sheets are chosen, below),
 *    add its exact tab name to SHEETS_TO_SKIP.
 * 5. Update COLUMN_ALIASES below if your header names differ from the
 *    guesses (name/phone especially — those are required per sheet).
 * 6. Run `importNewLeads` once manually (Run ▶ button, pick
 *    importNewLeads) and grant the permissions it asks for. Check the
 *    Execution log for a per-sheet summary.
 * 7. Run `setupTrigger` once — this schedules importNewLeads to run
 *    automatically every 5 minutes from then on. That's it.
 *
 * HOW MULTIPLE TABS ARE HANDLED
 * Every run scans EVERY tab in this spreadsheet. A tab is treated as a
 * lead sheet if it has recognizable Name and Phone columns (per
 * COLUMN_ALIASES below) — if it doesn't, that tab is just skipped, no
 * error, nothing to configure. This means: if Facebook starts dropping
 * leads into a brand-new "Sheet3" tomorrow, nothing needs to change
 * here — the next run picks it up automatically, as long as its header
 * row has Name and Phone columns like your other tabs.
 */

// Exact tab names to skip entirely, even if they happen to have
// Name/Phone-like columns (rare, but here as a safety valve). Leave
// empty ([]) to scan every tab, which is fine for most setups.
const SHEETS_TO_SKIP = []

// Header names this script writes/reads for its own bookkeeping. If a
// sheet doesn't have these columns yet, they're added automatically the
// first time the script runs.
const COL_IMPORTED = 'Imported'
const COL_IMPORTED_AT = 'Imported At'

// Left side = what the script looks for in your header row (case
// insensitive, first match wins). Add alternates if your sheet uses
// different wording — e.g. Facebook's native Sheets export usually uses
// "full_name" / "phone_number".
const COLUMN_ALIASES = {
  name: ['name', 'full name', 'full_name', 'lead name'],
  // Locked to your exact column header on purpose — every one of your
  // sheets uses "Mobile Number" specifically, so this no longer
  // matches "phone", "phone number", "contact number", etc., even if
  // a sheet happens to have one of those too.
  phone: ['mobile number'],
  notes: ['notes', 'message', 'comments', 'query'],
  source: ['source', 'campaign', 'ad name'],
  // Meta/Facebook attribution — these match the exact column names
  // Facebook Lead Ads writes into the sheet. Carried straight through
  // onto the lead in Supabase so it's never lost, and so the CRM can
  // later send Conversions API events back to Meta using it.
  metaLeadId: ['id', 'lead id', 'lead_id'],
  metaCreatedTime: ['created_time', 'created time'],
  metaAdId: ['ad_id', 'ad id'],
  metaAdName: ['ad_name', 'ad name'],
  metaAdsetId: ['adset_id', 'ad set id', 'adset id'],
  metaAdsetName: ['adset_name', 'ad set name', 'adset name'],
  metaCampaignId: ['campaign_id', 'campaign id'],
  metaCampaignName: ['campaign_name', 'campaign name'],
  metaFormId: ['form_id', 'form id'],
  metaFormName: ['form_name', 'form name'],
  metaIsOrganic: ['is_organic', 'is organic', 'organic'],
  metaPlatform: ['platform']
}

const DEFAULT_SOURCE = 'Facebook Ads' // must match a value in src/lib/constants.js LEAD_SOURCES

function importNewLeads() {
  const props = PropertiesService.getScriptProperties()
  const SUPABASE_URL = props.getProperty('SUPABASE_URL')
  const SERVICE_KEY = props.getProperty('SUPABASE_SERVICE_ROLE_KEY')

  if (!SUPABASE_URL || !SERVICE_KEY) {
    Logger.log('ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Script Properties first.')
    return
  }

  const sheets = SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()
    .filter((s) => SHEETS_TO_SKIP.indexOf(s.getName()) === -1)

  if (sheets.length === 0) {
    Logger.log('No sheets to scan (check SHEETS_TO_SKIP).')
    return
  }

  // Fetched once per run, reused across every tab — no need to look it
  // up per sheet.
  const adminId = fetchAdminId(SUPABASE_URL, SERVICE_KEY)

  const totals = { imported: 0, skippedDuplicate: 0, skippedInvalid: 0, failed: 0, sheetsScanned: 0, sheetsIgnored: 0 }

  for (const sheet of sheets) {
    const result = importFromSheet(sheet, SUPABASE_URL, SERVICE_KEY, adminId)
    if (result.ignored) {
      totals.sheetsIgnored++
      continue
    }
    totals.sheetsScanned++
    totals.imported += result.imported
    totals.skippedDuplicate += result.skippedDuplicate
    totals.skippedInvalid += result.skippedInvalid
    totals.failed += result.failed
  }

  Logger.log(
    `Import run complete across ${totals.sheetsScanned} sheet(s) (${totals.sheetsIgnored} tab(s) had no Name/Phone columns and were skipped) — ` +
      `imported: ${totals.imported}, duplicates skipped: ${totals.skippedDuplicate}, invalid skipped: ${totals.skippedInvalid}, failed: ${totals.failed}`
  )
}

/** Imports new leads from a single sheet/tab. Returns { ignored: true } if this tab isn't a lead sheet at all. */
function importFromSheet(sheet, SUPABASE_URL, SERVICE_KEY, adminId) {
  const sheetLabel = sheet.getName()
  const lastCol = sheet.getLastColumn()
  if (lastCol === 0) return { ignored: true } // completely empty tab

  let headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0]

  const nameCol = findColumn(headerRow, COLUMN_ALIASES.name)
  const phoneCol = findColumn(headerRow, COLUMN_ALIASES.phone)

  if (nameCol === -1 || phoneCol === -1) {
    // Not a lead sheet (or headers don't match yet) — quietly skip. This
    // is what lets new/unrelated tabs coexist without any setup.
    return { ignored: true }
  }

  const { headerRow: updatedHeaderRow, colIndex } = ensureBookkeepingColumns(sheet, headerRow)
  headerRow = updatedHeaderRow

  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return { ignored: false, imported: 0, skippedDuplicate: 0, skippedInvalid: 0, failed: 0 }

  const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
  const values = range.getValues()

  const notesCol = findColumn(headerRow, COLUMN_ALIASES.notes)
  const sourceCol = findColumn(headerRow, COLUMN_ALIASES.source)

  // Meta attribution columns — all optional; a sheet without them (e.g.
  // your manual, non-Facebook sheet) just won't populate these fields.
  const metaCols = {}
  for (const key of Object.keys(COLUMN_ALIASES)) {
    if (key.indexOf('meta') === 0) metaCols[key] = findColumn(headerRow, COLUMN_ALIASES[key])
  }

  let imported = 0,
    skippedDuplicate = 0,
    skippedInvalid = 0,
    failed = 0

  for (let i = 0; i < values.length; i++) {
    const sheetRow = i + 2 // 1-indexed + header row
    const row = values[i]

    if (String(row[colIndex.imported] || '').trim() !== '') continue // already processed

    const name = String(row[nameCol] || '').trim()
    const rawPhone = String(row[phoneCol] || '').trim()
    const phoneDigits = rawPhone.replace(/\D/g, '').slice(-10)

    if (!name || phoneDigits.length < 10) {
      sheet.getRange(sheetRow, colIndex.imported + 1).setValue('Skipped — invalid name/phone')
      skippedInvalid++
      continue
    }

    try {
      if (leadExists(SUPABASE_URL, SERVICE_KEY, phoneDigits)) {
        sheet.getRange(sheetRow, colIndex.imported + 1).setValue('Duplicate — already in CRM')
        skippedDuplicate++
        continue
      }

      const notes = notesCol !== -1 ? String(row[notesCol] || '').trim() : ''
      const source = sourceCol !== -1 && row[sourceCol] ? String(row[sourceCol]).trim() : DEFAULT_SOURCE
      const metaFields = buildMetaFields(row, metaCols)

      if (metaFields.meta_lead_id && metaLeadIdExists(SUPABASE_URL, SERVICE_KEY, metaFields.meta_lead_id)) {
        sheet.getRange(sheetRow, colIndex.imported + 1).setValue('Duplicate — Meta Lead ID already in CRM')
        skippedDuplicate++
        continue
      }

      // Left unassigned on purpose — it lands in the Lead Pool, and an
      // admin assigns it (specific agent or Round Robin) from there.
      // Also left with no follow-up date: it sits in "New Leads" until
      // the assigned agent logs the first call, same as any other lead.
      const payload = Object.assign(
        {
          name,
          phone: rawPhone,
          source,
          notes: notes || null,
          status: 'new',
          call_status: null, // no calls made yet — CRM shows this as "No calls yet", i.e. pending
          next_action: null,
          next_followup_date: null,
          origin: 'facebook',
          // The sheet tab's own name IS the project name — rename a tab
          // to "Green Valley" and every lead from it is tagged Green
          // Valley. New tabs for new campaigns need zero setup here.
          // Tabs still on a default name (Sheet1, Sheet2...) are left
          // blank rather than saving a meaningless "Sheet1" as a project.
          project: isDefaultSheetName(sheetLabel) ? null : sheetLabel,
          assigned_to: null,
          created_by: adminId
        },
        metaFields
      )

      insertLead(SUPABASE_URL, SERVICE_KEY, payload)

      sheet.getRange(sheetRow, colIndex.imported + 1).setValue('TRUE')
      sheet.getRange(sheetRow, colIndex.importedAt + 1).setValue(new Date())
      imported++
    } catch (err) {
      // Never let one bad row stop the rest of the batch.
      sheet.getRange(sheetRow, colIndex.imported + 1).setValue('ERROR — ' + String(err).slice(0, 200))
      Logger.log(`[${sheetLabel}] Row ${sheetRow} failed: ${err}`)
      failed++
    }
  }

  if (imported || skippedDuplicate || skippedInvalid || failed) {
    Logger.log(
      `[${sheetLabel}] imported: ${imported}, duplicates skipped: ${skippedDuplicate}, invalid skipped: ${skippedInvalid}, failed: ${failed}`
    )
  }

  return { ignored: false, imported, skippedDuplicate, skippedInvalid, failed }
}

/** Adds Imported / Imported At columns if missing, returns their positions. */
function ensureBookkeepingColumns(sheet, headerRow) {
  function ensure(name) {
    let idx = headerRow.findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase())
    if (idx === -1) {
      sheet.getRange(1, headerRow.length + 1).setValue(name)
      headerRow.push(name)
      idx = headerRow.length - 1
    }
    return idx
  }

  const imported = ensure(COL_IMPORTED)
  const importedAt = ensure(COL_IMPORTED_AT)
  return { headerRow, colIndex: { imported, importedAt } }
}

/** True for untouched default tab names like "Sheet1" / "Copy of Sheet 2" — those aren't real project names. */
function isDefaultSheetName(name) {
  return /^(copy of\s+)?sheet\s*\d*$/i.test(String(name || '').trim())
}

function findColumn(headerRow, aliases) {
  for (const alias of aliases) {
    const idx = headerRow.findIndex((h) => String(h).trim().toLowerCase() === alias.toLowerCase())
    if (idx !== -1) return idx
  }
  return -1
}

/** Reads whichever Meta attribution columns exist in this row into the Supabase field names. */
function buildMetaFields(row, metaCols) {
  const get = (col) => (col !== -1 && row[col] !== '' && row[col] != null ? String(row[col]).trim() : null)

  const isOrganicRaw = get(metaCols.metaIsOrganic)
  let isOrganic = null
  if (isOrganicRaw !== null) {
    isOrganic = ['true', 'yes', '1'].indexOf(isOrganicRaw.toLowerCase()) !== -1
  }

  let createdTime = null
  const createdRaw = metaCols.metaCreatedTime !== -1 ? row[metaCols.metaCreatedTime] : null
  if (createdRaw) {
    const d = createdRaw instanceof Date ? createdRaw : new Date(createdRaw)
    if (!isNaN(d.getTime())) createdTime = d.toISOString()
  }

  return {
    meta_lead_id: get(metaCols.metaLeadId),
    meta_created_time: createdTime,
    meta_ad_id: get(metaCols.metaAdId),
    meta_ad_name: get(metaCols.metaAdName),
    meta_adset_id: get(metaCols.metaAdsetId),
    meta_adset_name: get(metaCols.metaAdsetName),
    meta_campaign_id: get(metaCols.metaCampaignId),
    meta_campaign_name: get(metaCols.metaCampaignName),
    meta_form_id: get(metaCols.metaFormId),
    meta_form_name: get(metaCols.metaFormName),
    meta_is_organic: isOrganic,
    meta_platform: get(metaCols.metaPlatform)
  }
}

// ---- Supabase REST helpers -------------------------------------------

function supabaseHeaders(serviceKey, extra) {
  return Object.assign(
    {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json'
    },
    extra || {}
  )
}

function leadExists(url, key, phoneDigits) {
  const resp = UrlFetchApp.fetch(
    `${url}/rest/v1/leads?select=id&phone_digits=eq.${encodeURIComponent(phoneDigits)}&limit=1`,
    { method: 'get', headers: supabaseHeaders(key), muteHttpExceptions: true }
  )
  if (resp.getResponseCode() >= 300) throw new Error('Dedup check failed: ' + resp.getContentText())
  const data = JSON.parse(resp.getContentText())
  return Array.isArray(data) && data.length > 0
}

function metaLeadIdExists(url, key, metaLeadId) {
  const resp = UrlFetchApp.fetch(
    `${url}/rest/v1/leads?select=id&meta_lead_id=eq.${encodeURIComponent(metaLeadId)}&limit=1`,
    { method: 'get', headers: supabaseHeaders(key), muteHttpExceptions: true }
  )
  if (resp.getResponseCode() >= 300) throw new Error('Meta Lead ID dedup check failed: ' + resp.getContentText())
  const data = JSON.parse(resp.getContentText())
  return Array.isArray(data) && data.length > 0
}

function fetchAdminId(url, key) {
  const resp = UrlFetchApp.fetch(`${url}/rest/v1/profiles?select=id&role=eq.admin&order=created_at.asc&limit=1`, {
    method: 'get',
    headers: supabaseHeaders(key),
    muteHttpExceptions: true
  })
  if (resp.getResponseCode() >= 300) {
    Logger.log('Could not fetch admin id, leads will be created_by = the assigned agent instead: ' + resp.getContentText())
    return null
  }
  const data = JSON.parse(resp.getContentText())
  return data && data[0] ? data[0].id : null
}

function insertLead(url, key, payload) {
  const resp = UrlFetchApp.fetch(`${url}/rest/v1/leads`, {
    method: 'post',
    headers: supabaseHeaders(key, { Prefer: 'return=minimal' }),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  })
  if (resp.getResponseCode() >= 300) throw new Error('Insert failed: ' + resp.getContentText())
}

// ---- Trigger management -------------------------------------------

/** Run this once from the Apps Script editor to schedule automatic imports every 5 minutes. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'importNewLeads') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('importNewLeads').timeBased().everyMinutes(5).create()
  Logger.log('Trigger installed — importNewLeads will now run every 5 minutes, scanning every tab.')
}

/** Optional: run this if you ever want to stop automatic imports. */
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'importNewLeads') ScriptApp.deleteTrigger(t)
  })
  Logger.log('Trigger removed.')
}
