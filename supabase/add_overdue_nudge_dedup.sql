-- Adds the dedup rule for the new "overdue follow-up" nudge — one per
-- lead per day, separate from the on-time follow-up reminder.
create unique index if not exists notification_log_overdue_uidx
  on public.notification_log(lead_id, sent_for_date)
  where kind = 'overdue_nudge';
