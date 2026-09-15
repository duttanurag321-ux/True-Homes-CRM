-- ============================================================
-- STEP 1 — Paste this whole file into Supabase SQL Editor, click Run.
-- Everything is already filled in with your real project info.
-- ============================================================

do $$
begin
  perform cron.unschedule('send-meta-conversions');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('send-followup-time-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'send-followup-time-reminders',
  '*/5 2-14 * * *',
  $$
  select net.http_post(
    url := 'https://hltwmvfljppjkiyimxfh.supabase.co/functions/v1/notify-followup-time',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdHdtdmZsanBwamtpeWlteGZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NzQ5NzcsImV4cCI6MjEwNDI1MDk3N30.BGVbMQcUNWhlvIj6wArRWe9PmgyDjS2m_McO90OlChc',
      'x-webhook-secret', 'th-secret-7k2m9x'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'send-morning-digest',
  '30 2 * * *',
  $$
  select net.http_post(
    url := 'https://hltwmvfljppjkiyimxfh.supabase.co/functions/v1/notify-morning-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdHdtdmZsanBwamtpeWlteGZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NzQ5NzcsImV4cCI6MjEwNDI1MDk3N30.BGVbMQcUNWhlvIj6wArRWe9PmgyDjS2m_McO90OlChc',
      'x-webhook-secret', 'th-secret-7k2m9x'
    ),
    body := '{}'::jsonb
  );
  $$
);

do $$
begin
  perform cron.unschedule('cleanup-notification-log');
exception when others then
  null;
end $$;

select cron.schedule(
  'cleanup-notification-log',
  '0 20 * * *',
  $$ delete from public.notification_log where created_at < now() - interval '14 days'; $$
);
