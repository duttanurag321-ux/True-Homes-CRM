-- STEP 3 (optional but recommended) — run this last to confirm
-- everything worked. Paste into SQL Editor, click Run, look at the
-- results.

select jobname, schedule, active from cron.job order by jobname;

-- You should see exactly these 3 rows, all with active = true:
--   cleanup-notification-log
--   send-followup-time-reminders
--   send-morning-digest
--
-- You should NOT see a row for send-meta-conversions — that one being
-- missing is correct, it's intentionally turned off.
