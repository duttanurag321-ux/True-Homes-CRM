-- Runs the send-meta-conversions function every 2 minutes, processing
-- whatever's waiting in the meta_conversion_events queue. Ad-attribution
-- timing isn't as time-critical as a follow-up reminder, so this doesn't
-- need to be as fast as the notification checks.
select cron.schedule(
  'send-meta-conversions',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://pfxzdrvwvvykkcexojii.supabase.co/functions/v1/send-meta-conversions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmeHpkcnZ3dnZ5a2tjZXhvamlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMDE2OTQsImV4cCI6MjEwMjc3NzY5NH0.vZYUa30NScZf_OhXGa3umCEn0kTh7dQPwFBdq_UdvUY',
      'x-webhook-secret', 'th-secret-7k2m9x'
    ),
    body := '{}'::jsonb
  );
  $$
);
