-- Fixes a real bug: the old dedup rule allowed only ONE follow-up-time
-- notification per lead per day, no matter what — so rescheduling the
-- same lead to a new time later the same day silently got skipped,
-- looking like notifications had "stopped working" after the first one.
-- Now it's keyed on the lead + day + the specific time, so a new time
-- is treated as a new reminder, while the exact same time still only
-- ever fires once (no duplicate spam from the job re-checking).

alter table public.notification_log add column if not exists detail text;

drop index if exists public.notification_log_followup_uidx;
create unique index notification_log_followup_uidx
  on public.notification_log(lead_id, sent_for_date, detail)
  where kind = 'followup_time';
