-- ============================================================
-- FINAL LIFETIME-SAFE LOCKDOWN (4 users)
-- Run this on your NEW project — replace the 3 placeholders
-- (YOUR-PROJECT-REF, YOUR-ANON-KEY, YOUR-FUNCTION-SECRET) with your
-- real values before running.
-- ============================================================

-- ---- 1. Turn off the Meta Conversions cron job for now --------------
-- You said Facebook ad tracking isn't a priority right now — no reason
-- to keep calling that function every few minutes if it's not needed.
-- Nothing is deleted; the moment you want it back, re-run the
-- cron.schedule block for it and it starts again with zero setup.
select cron.unschedule('send-meta-conversions');

-- ---- 2. Follow-up reminders — every 5 minutes, business hours only --
-- With 4 people, checking every 5 minutes instead of every 1-2 is
-- still functionally instant (a follow-up notification arrives within
-- 5 minutes of the time you set — nobody will notice), and cuts the
-- daily call count by more than half again versus the last version.
select cron.unschedule('send-followup-time-reminders');

select cron.schedule(
  'send-followup-time-reminders',
  '*/5 2-14 * * *', -- every 5 min, 7:30 AM–8:59 PM IST (covers your 8am-8pm business hours with a small margin)
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-followup-time',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-ANON-KEY',
      'x-webhook-secret', 'YOUR-FUNCTION-SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---- 3. Morning digest — unchanged, once a day, negligible cost -----
select cron.schedule(
  'send-morning-digest',
  '30 2 * * *', -- 8:00 AM IST
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-morning-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-ANON-KEY',
      'x-webhook-secret', 'YOUR-FUNCTION-SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---- 4. Keep the database small forever, automatically --------------
-- notification_log exists purely to prevent double-sending a
-- notification on the same day — it never needs history older than a
-- week. Left alone it would grow forever; this trims it daily so it
-- never becomes a meaningful chunk of your 500 MB database limit. This
-- runs entirely inside the database — no network call, no egress cost
-- at all, just a few milliseconds of cleanup.
select cron.unschedule('cleanup-notification-log');

select cron.schedule(
  'cleanup-notification-log',
  '0 20 * * *', -- once a day, 1:30 AM IST
  $$ delete from public.notification_log where created_at < now() - interval '14 days'; $$
);

-- ============================================================
-- Verify everything landed correctly:
--   select jobname, schedule, active from cron.job order by jobname;
-- You should see exactly 3 active jobs: send-followup-time-reminders,
-- send-morning-digest, cleanup-notification-log. send-meta-conversions
-- should NOT appear (or appear with active = false) — that's correct,
-- it's intentionally off for now.
-- ============================================================
