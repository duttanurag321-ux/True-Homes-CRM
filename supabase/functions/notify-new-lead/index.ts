// notify-new-lead — called directly by a database trigger the instant a
// lead's assigned_to changes to a real agent. Sends that one agent a
// push notification. See supabase/notifications_pack.sql for the
// trigger, and the README for how to deploy this + set its secrets.
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
        // The browser/device un-registered this subscription (uninstalled,
        // cleared data, etc.) — clean it up so we stop trying.
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== FUNCTION_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json()
  const record = body.record
  const oldRecord = body.old_record

  if (!record?.assigned_to) return new Response('ok', { status: 200 })
  if (oldRecord && oldRecord.assigned_to === record.assigned_to) return new Response('ok', { status: 200 })

  await sendToUser(record.assigned_to, {
    title: 'New lead assigned',
    body: record.name || 'A new lead was assigned to you',
    url: `${APP_URL}leads/${record.id}`,
    tag: `lead-${record.id}`
  })

  return new Response('ok', { status: 200 })
})
