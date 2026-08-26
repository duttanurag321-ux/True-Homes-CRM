// notify-followup-time — called every few seconds by a scheduled job
// (see supabase/notifications_pack.sql + reschedule_followup_check*.sql).
// Two things happen here:
//   1. A lead due TODAY (IST) with a specific TIME set gets notified
//      right as that time arrives.
//   2. Any lead that's now OVERDUE (due on an earlier day, still not
//      closed) gets one gentle nudge per day — separate wording so it
//      reads as "this is late", not "this is due right now".
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
// comparison below is anchored through these helpers instead of the
// server's own timezone, which is what caused a 6:45 PM follow-up to
// fire at 12:15 AM the next day (a straight 5-hour-30-minute miss).
const IST_OFFSET_MIN = 330

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MIN * 60000)
}

function todayIST() {
  return nowIST().toISOString().slice(0, 10)
}

function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
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
  // Comfortably covers this job's check cadence plus a little scheduling
  // drift, without a real due time waiting long to be caught.
  const windowStart = new Date(now.getTime() - 2 * 60000)

  // ---- 1. Exact-time reminders, due today ----------------------------
  const { data: dueNow } = await supabase
    .from('leads')
    .select('id,name,assigned_to,next_followup_time,status')
    .eq('next_followup_date', today)
    .not('next_followup_time', 'is', null)
    .not('assigned_to', 'is', null)
    .not('status', 'in', '("won","lost")')

  for (const lead of dueNow || []) {
    const timeStr = String(lead.next_followup_time).slice(0, 5)
    const followupAtUtc = istWallClockToUtc(today, timeStr)
    if (followupAtUtc > now || followupAtUtc < windowStart) continue

    const { error: logErr } = await supabase
      .from('notification_log')
      .insert({ kind: 'followup_time', lead_id: lead.id, user_id: lead.assigned_to, sent_for_date: today, detail: timeStr })
    if (logErr) continue // already sent for this exact lead+time today — skip silently

    await sendToUser(lead.assigned_to, {
      title: '⏰ Follow-up time',
      body: `You have a follow-up now — ${lead.name} at ${formatTime12h(timeStr)}`,
      url: `${APP_URL}leads/${lead.id}`,
      tag: `followup-${lead.id}`
    })
  }

  // ---- 2. Overdue nudge, once per lead per day -----------------------
  const { data: overdue } = await supabase
    .from('leads')
    .select('id,name,assigned_to,status')
    .lt('next_followup_date', today)
    .not('call_status', 'is', null) // only ever-contacted leads count as a "follow-up" — matches the app's own Work Queue definition
    .not('assigned_to', 'is', null)
    .not('status', 'in', '("won","lost")')

  for (const lead of overdue || []) {
    const { error: logErr } = await supabase
      .from('notification_log')
      .insert({ kind: 'overdue_nudge', lead_id: lead.id, user_id: lead.assigned_to, sent_for_date: today })
    if (logErr) continue // already nudged about this lead today — skip silently

    await sendToUser(lead.assigned_to, {
      title: '🔴 Overdue follow-up',
      body: `You have an overdue follow-up to do now — ${lead.name}`,
      url: `${APP_URL}leads/${lead.id}`,
      tag: `overdue-${lead.id}`
    })
  }

  return new Response('ok', { status: 200 })
})
