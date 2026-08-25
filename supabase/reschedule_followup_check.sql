-- Run this after re-deploying the updated notify-followup-time function
-- (see README/chat for the code). This just changes HOW OFTEN it's
-- checked — from every 15 minutes to every minute — so a follow-up
-- fires within about a minute of its set time instead of up to 15
-- minutes late.
select cron.unschedule('send-followup-time-reminders');

select cron.schedule(
  'send-followup-time-reminders',
  '* * * * *',
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
