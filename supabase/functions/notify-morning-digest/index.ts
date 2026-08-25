// notify-morning-digest — called once a day by a scheduled job (see
// supabase/notifications_pack.sql). Sends each agent a single "you have
// N follow-ups today" push, counting everything due today (IST)
// regardless of whether it also has a specific time set.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'
const FUNCTION_SECRET = Deno.env.get('FUNCTION_SECRET')!
const APP_URL = (Deno.env.get('APP_URL') || 'https://example.github.io/True-Homes-CRM/').replace(/\/+$/, '/')

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const IST_OFFSET_MIN = 330
function todayIST() {
  return new Date(Date.now() + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10)
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

  const today = todayIST()

  const { data: leads } = await supabase
    .from('leads')
    .select('id,assigned_to')
    .eq('next_followup_date', today)
    .not('assigned_to', 'is', null)
    .not('call_status', 'is', null) // only counts leads that have actually been called before — matches the app's own "Follow-ups" definition
    .not('status', 'in', '("won","lost")')

  const counts = new Map<string, number>()
  for (const l of leads || []) {
    counts.set(l.assigned_to as string, (counts.get(l.assigned_to as string) || 0) + 1)
  }

  for (const [userId, count] of counts) {
    const { error: logErr } = await supabase.from('notification_log').insert({ kind: 'morning_digest', user_id: userId, sent_for_date: today })
    if (logErr) continue // already sent today — skip silently

    await sendToUser(userId, {
      title: "Today's follow-ups",
      body: `You have ${count} follow-up${count === 1 ? '' : 's'} due today.`,
      url: APP_URL,
      tag: 'morning-digest'
    })
  }

  return new Response('ok', { status: 200 })
})
