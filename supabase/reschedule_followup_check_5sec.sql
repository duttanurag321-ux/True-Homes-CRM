-- Switches the follow-up-time check from once a minute to every 5
-- seconds. Note: this means ~17,000 calls/day to this one function —
-- comfortably fine functionally, but worth knowing if you're watching
-- Supabase's free-tier usage. If you ever want to dial it back, re-run
-- this with a different interval, e.g. '15 seconds' or '1 minute'.
select cron.unschedule('send-followup-time-reminders');

select cron.schedule(
  'send-followup-time-reminders',
  '5 seconds',
  $$
  select net.http_post(
    url := 'https://pfxzdrvwvvykkcexojii.supabase.co/functions/v1/notify-followup-time',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmeHpkcnZ3dnZ5a2tjZXhvamlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMDE2OTQsImV4cCI6MjEwMjc3NzY5NH0.vZYUa30NScZf_OhXGa3umCEn0kTh7dQPwFBdq_UdvUY',
      'x-webhook-secret', 'th-secret-7k2m9x'
    ),
    body := '{}'::jsonb
  );
  $$
);
