// notify-followup-time — called every 15 minutes by a scheduled job
// (see supabase/notifications_pack.sql). Finds any lead due TODAY with
// a specific follow-up TIME set, whose time has just passed, and
// notifies the assigned agent — once each, even if this runs again a
// few minutes later (notification_log enforces that).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'
const FUNCTION_SECRET = Deno.env.get('FUNCTION_SECRET')!
const APP_URL = Deno.env.get('APP_URL') || 'https://example.github.io/True-Homes-CRM/'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

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
  const today = now.toISOString().slice(0, 10)
  // Catch any time inside the last 15 minutes — matches how often this
  // is scheduled to run, so a 9:00 follow-up still fires even if this
  // particular run happens to land at 9:07.
  const windowStart = new Date(now.getTime() - 15 * 60000)

  const { data: leads } = await supabase
    .from('leads')
    .select('id,name,assigned_to,next_followup_time,status')
    .eq('next_followup_date', today)
    .not('next_followup_time', 'is', null)
    .not('assigned_to', 'is', null)
    .not('status', 'in', '("won","lost")')

  for (const lead of leads || []) {
    const [hh, mm] = String(lead.next_followup_time).split(':').map(Number)
    const followupAt = new Date(now)
    followupAt.setHours(hh, mm, 0, 0)
    if (followupAt > now || followupAt < windowStart) continue

    const { error: logErr } = await supabase
      .from('notification_log')
      .insert({ kind: 'followup_time', lead_id: lead.id, user_id: lead.assigned_to, sent_for_date: today })
    if (logErr) continue // already sent today for this lead — the unique index rejected it, skip silently

    await sendToUser(lead.assigned_to, {
      title: 'Follow-up time',
      body: `${lead.name} — ${String(lead.next_followup_time).slice(0, 5)}`,
      url: `${APP_URL}leads/${lead.id}`,
      tag: `followup-${lead.id}`
    })
  }

  return new Response('ok', { status: 200 })
})
