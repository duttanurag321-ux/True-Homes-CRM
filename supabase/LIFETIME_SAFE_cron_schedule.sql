-- ============================================================
-- LIFETIME-SAFE CRON SCHEDULE (new project)
-- Run this AFTER deploying the 4 Edge Functions and setting their
-- secrets on the NEW project. Replace YOUR-PROJECT-REF, YOUR-ANON-KEY,
-- and YOUR-FUNCTION-SECRET with your new project's real values in
-- all three blocks below before running.
--
-- Why these numbers: with only 4 users, the old settings (checking
-- every 1-5 seconds, 24 hours a day) were using far more of the free
-- tier than 4 people could ever need. These are sized generously for
-- real usage while cutting background calls by roughly 8-10x:
--   - Follow-up time check: every 2 minutes, but ONLY between 6 AM
--     and 11 PM IST — nobody is setting or expecting a business
--     follow-up notification at 3 AM, so there's no reason to poll
--     then. Still notifies you within ~2 minutes of the set time
--     during the day, which is functionally instant for this purpose.
--   - Meta conversions: every 5 minutes — ad attribution isn't
--     remotely time-sensitive, a few minutes' delay changes nothing.
-- ============================================================

select cron.unschedule('send-followup-time-reminders');
select cron.unschedule('send-meta-conversions');

-- Follow-up time reminders — every 2 min, 6 AM–11 PM IST
-- (IST is UTC+5:30, so 6 AM–11 PM IST = 00:30–17:30 UTC — using the
-- whole-hour range 0-17 UTC to keep this simple, which covers 5:30
-- AM–11:30 PM IST, a safe margin either side of real business hours)
select cron.schedule(
  'send-followup-time-reminders',
  '*/2 0-17 * * *',
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

-- Meta conversions — every 5 minutes, all day (fine to run 24h, it's
-- cheap: usually finds 0 pending events and does almost nothing)
select cron.schedule(
  'send-meta-conversions',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-meta-conversions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-ANON-KEY',
      'x-webhook-secret', 'YOUR-FUNCTION-SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Morning digest — unchanged, once a day at 8:00 AM IST (02:30 UTC)
select cron.schedule(
  'send-morning-digest',
  '30 2 * * *',
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

-- ============================================================
-- If you ever see a Fair Use warning again with only 4 users, the
-- fastest additional lever (no code change) is widening the interval
-- further — e.g. change '*/2 0-17' to '*/5 0-17' (every 5 min instead
-- of 2) by re-running just that one cron.schedule block above with a
-- new interval; it always cleanly replaces the existing schedule.
-- ============================================================
