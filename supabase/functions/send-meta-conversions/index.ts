// send-meta-conversions — called every couple of minutes by a scheduled
// job (see supabase/meta_conversions_pack.sql for the queue + trigger,
// and the setup instructions for the cron schedule). Processes pending
// rows in meta_conversion_events and sends each to Meta's Conversions
// API for CRM, using the lead's preserved Meta attribution data.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FUNCTION_SECRET = Deno.env.get('FUNCTION_SECRET')!
const META_PIXEL_ID = Deno.env.get('META_PIXEL_ID')!
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN')!
// Only set this secret temporarily while testing — see setup
// instructions. Leave it unset for real/production sending.
const META_TEST_EVENT_CODE = Deno.env.get('META_TEST_EVENT_CODE') || ''
const META_API_VERSION = 'v21.0'

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 25

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Matches the normalization the CRM itself already uses when saving a
// lead's phone number — digits only, with the 91 country code.
function normalizeIndianPhoneDigits(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return '91' + digits
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1)
  return digits
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== FUNCTION_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: events } = await supabase
    .from('meta_conversion_events')
    .select('id, lead_id, event_type, attempts')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  let sent = 0,
    skipped = 0,
    failed = 0

  for (const event of events || []) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id,name,phone,meta_lead_id,budget_max,call_status,status,created_at')
      .eq('id', event.lead_id)
      .maybeSingle()

    if (!lead) {
      await supabase.from('meta_conversion_events').update({ status: 'skipped', last_error: 'Lead no longer exists' }).eq('id', event.id)
      skipped++
      continue
    }

    if (!lead.meta_lead_id) {
      // Not a Facebook lead (or the Meta ID never made it through the
      // import) — nothing reliable to attribute this to, so don't keep
      // retrying forever.
      await supabase
        .from('meta_conversion_events')
        .update({ status: 'skipped', last_error: 'No meta_lead_id on this lead — likely not a Facebook lead, or it predates this integration.' })
        .eq('id', event.id)
      skipped++
      continue
    }

    const userData: Record<string, unknown> = { lead_id: lead.meta_lead_id }
    if (lead.phone) userData.ph = [await sha256Hex(normalizeIndianPhoneDigits(lead.phone))]
    if (lead.name) {
      const firstName = String(lead.name).trim().split(/\s+/)[0]
      if (firstName) userData.fn = [await sha256Hex(firstName.toLowerCase())]
    }

    const customData: Record<string, unknown> = {}
    if (event.event_type === 'Booking' && lead.budget_max) {
      customData.currency = 'INR'
      customData.value = Number(lead.budget_max)
    }

    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: event.event_type,
          event_time: Math.floor(Date.now() / 1000),
          event_id: `${lead.id}-${event.event_type}`, // stable id — if Meta ever receives it twice, it dedupes on its own side too
          action_source: 'system_generated',
          user_data: userData,
          ...(Object.keys(customData).length ? { custom_data: customData } : {})
        }
      ]
    }
    if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE

    try {
      const resp = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const respBody = await resp.text()

      if (!resp.ok) {
        throw new Error(`Meta responded ${resp.status}: ${respBody.slice(0, 500)}`)
      }

      await supabase.from('meta_conversion_events').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', event.id)

      const flagColumn =
        event.event_type === 'Qualified' ? 'qualified_event_sent' : event.event_type === 'SiteVisit' ? 'site_visit_event_sent' : 'booking_event_sent'
      await supabase.from('leads').update({ [flagColumn]: true }).eq('id', lead.id)

      sent++
    } catch (err) {
      const attempts = event.attempts + 1
      await supabase
        .from('meta_conversion_events')
        .update({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          last_error: String((err as Error)?.message || err).slice(0, 500)
        })
        .eq('id', event.id)
      failed++
    }
  }

  return new Response(JSON.stringify({ sent, skipped, failed }), { headers: { 'Content-Type': 'application/json' } })
})
