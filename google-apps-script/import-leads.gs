/**
 * Broker CRM — Automatic Lead Importer
 * ------------------------------------
 * Watches a Google Sheet (where Facebook leads land) and pushes every new
 * row into the Supabase `leads` table as an UNASSIGNED lead in the app's
 * Lead Pool — dedups by phone, and marks the row as imported so it's
 * never processed twice. Assigning leads to agents (specific agent or
 * round robin) now happens from the Lead Pool screen in the app itself,
 * not from this script — that way it always uses your current agent
 * list and each agent's "Receiving Leads" toggle.
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
 * 4. Update SHEET_NAME below if your tab isn't called "Sheet1".
 * 5. Update COLUMN_ALIASES below if your header names differ from the
 *    guesses (name/phone especially — those are required).
 * 6. Run `importNewLeads` once manually (Run ▶ button, pick
 *    importNewLeads) and grant the permissions it asks for. Check the
 *    Execution log for a summary line.
 * 7. Run `setupTrigger` once — this schedules importNewLeads to run
 *    automatically every 5 minutes from then on. That's it.
 */

const SHEET_NAME = 'Sheet1' // change if your leads land on a different tab

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
  phone: ['phone', 'phone number', 'phone_number', 'mobile', 'contact number'],
  notes: ['notes', 'message', 'comments', 'query'],
  source: ['source', 'campaign', 'ad name']
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

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
  if (!sheet) {
    Logger.log(`ERROR: No sheet named "${SHEET_NAME}" found.`)
    return
  }

  const { headerRow, colIndex } = ensureBookkeepingColumns(sheet)
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) {
    Logger.log('No data rows yet.')
    return
  }

  const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
  const values = range.getValues()

  const nameCol = findColumn(headerRow, COLUMN_ALIASES.name)
  const phoneCol = findColumn(headerRow, COLUMN_ALIASES.phone)
  const notesCol = findColumn(headerRow, COLUMN_ALIASES.notes)
  const sourceCol = findColumn(headerRow, COLUMN_ALIASES.source)

  if (nameCol === -1 || phoneCol === -1) {
    Logger.log('ERROR: Could not find a Name and/or Phone column. Check COLUMN_ALIASES matches your header row.')
    return
  }

  // Cache today's admin (used as created_by) once per run instead of once
  // per row.
  const adminId = fetchAdminId(SUPABASE_URL, SERVICE_KEY)

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

      // Left unassigned on purpose — it lands in the Lead Pool, and an
      // admin assigns it (specific agent or Round Robin) from there.
      // Also left with no follow-up date: it sits in "New Leads" until
      // the assigned agent logs the first call, same as any other lead.
      const payload = {
        name,
        phone: rawPhone,
        source,
        notes: notes || null,
        status: 'new',
        call_status: null, // no calls made yet — CRM shows this as "No calls yet", i.e. pending
        next_action: null,
        next_followup_date: null,
        origin: 'facebook',
        assigned_to: null,
        created_by: adminId
      }

      insertLead(SUPABASE_URL, SERVICE_KEY, payload)

      sheet.getRange(sheetRow, colIndex.imported + 1).setValue('TRUE')
      sheet.getRange(sheetRow, colIndex.importedAt + 1).setValue(new Date())
      imported++
    } catch (err) {
      // Never let one bad row stop the rest of the batch.
      sheet.getRange(sheetRow, colIndex.imported + 1).setValue('ERROR — ' + String(err).slice(0, 200))
      Logger.log(`Row ${sheetRow} failed: ${err}`)
      failed++
    }
  }

  Logger.log(
    `Import run complete — imported: ${imported}, duplicates skipped: ${skippedDuplicate}, invalid skipped: ${skippedInvalid}, failed: ${failed}`
  )
}

/** Adds Imported / Imported At / Assigned Agent columns if missing, returns their positions. */
function ensureBookkeepingColumns(sheet) {
  const lastCol = sheet.getLastColumn()
  let headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0]

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

function findColumn(headerRow, aliases) {
  for (const alias of aliases) {
    const idx = headerRow.findIndex((h) => String(h).trim().toLowerCase() === alias.toLowerCase())
    if (idx !== -1) return idx
  }
  return -1
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
  Logger.log('Trigger installed — importNewLeads will now run every 5 minutes.')
}

/** Optional: run this if you ever want to stop automatic imports. */
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'importNewLeads') ScriptApp.deleteTrigger(t)
  })
  Logger.log('Trigger removed.')
}
