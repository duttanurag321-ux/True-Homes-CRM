// notify-followup-time — called every minute by a scheduled job (see
// supabase/notifications_pack.sql). Finds any lead due TODAY (in IST)
// with a specific follow-up TIME set, whose time has just passed, and
// notifies the assigned agent — once each, even if this runs again a
// minute later (notification_log enforces that).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'
const FUNCTION_SECRET = Deno.env.get('FUNCTION_SECRET')!
// Always ends with exactly one trailing slash, regardless of whether the
// secret was set with or without one — a missing/extra slash here was
// what made notification taps land on a broken/404 link before.
const APP_URL = (Deno.env.get('APP_URL') || 'https://example.github.io/True-Homes-CRM/').replace(/\/+$/, '/')

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// The whole point of this table is dates/times as entered by an Indian
// agent, in IST — but this function runs on a UTC clock. Every time
// comparison below is anchored through these two helpers instead of the
// server's own timezone, which is what caused a 6:45 PM follow-up to
// fire at 12:15 AM the next day (a straight 5-hour-30-minute miss).
const IST_OFFSET_MIN = 330

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MIN * 60000)
}

function todayIST() {
  return nowIST().toISOString().slice(0, 10)
}

// Treats `date` + `time` as IST wall-clock values and returns the actual
// UTC instant they refer to — so it can be compared against a real
// `Date.now()`.
function istWallClockToUtc(dateStr: string, timeStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - IST_OFFSET_MIN * 60000)
}

async function sendToUser(userId: string, payload: Record<string, unknown>) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId)
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload))
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== FUNCTION_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const today = todayIST()
  // This job runs every minute — a 2-minute window comfortably covers
  // that cadence plus a little scheduling drift, without waiting long.
  const windowStart = new Date(now.getTime() - 2 * 60000)

  const { data: leads } = await supabase
    .from('leads')
    .select('id,name,assigned_to,next_followup_time,status')
    .eq('next_followup_date', today)
    .not('next_followup_time', 'is', null)
    .not('assigned_to', 'is', null)
    .not('status', 'in', '("won","lost")')

  for (const lead of leads || []) {
    const followupAtUtc = istWallClockToUtc(today, String(lead.next_followup_time).slice(0, 5))
    if (followupAtUtc > now || followupAtUtc < windowStart) continue

    const { error: logErr } = await supabase
      .from('notification_log')
      .insert({ kind: 'followup_time', lead_id: lead.id, user_id: lead.assigned_to, sent_for_date: today, detail: String(lead.next_followup_time).slice(0, 5) })
    if (logErr) continue // already sent for this exact lead+time today — the unique index rejected it, skip silently

    await sendToUser(lead.assigned_to, {
      title: 'Follow-up time',
      body: `${lead.name} — ${String(lead.next_followup_time).slice(0, 5)}`,
      url: `${APP_URL}leads/${lead.id}`,
      tag: `followup-${lead.id}`
    })
  }

  return new Response('ok', { status: 200 })
})
