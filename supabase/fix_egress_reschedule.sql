-- Fixes the Supabase "Fair Use" quota warning. The follow-up-time check
-- running every 5 seconds means ~17,000 calls/day, every day, forever —
-- each one querying the leads table — which is almost certainly the
-- main driver of the egress overage. This dials it back to once a
-- minute (~1,440 calls/day, a 12x reduction), which is still fast
-- enough that no one will notice the difference in practice, but is
-- comfortably sustainable on the free tier long-term.
--
-- If you want a middle ground instead, change '* * * * *' below to
-- '*/2 * * * *' (every 2 minutes) or '*/3 * * * *' (every 3 minutes)
-- for even more savings, or run this again later with a different
-- value — it always replaces the existing schedule cleanly.
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

-- No Edge Function code changes needed for this — the 2-minute "catch
-- anything due recently" window already built into notify-followup-time
-- works fine at this slower cadence too. This SQL file alone is the fix.
