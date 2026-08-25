-- ============================================================
-- NOTIFICATIONS PACK — real push notifications for new leads and
-- follow-ups (works even when the app is closed, on Android; on iOS
-- it works too, but only if the app was added to the Home Screen).
--
-- Run this AFTER you've:
--   1. Deployed the three Edge Functions (see README).
--   2. Set the Edge Function secrets (see README).
-- Then replace the two placeholders below — YOUR-PROJECT-REF and
-- YOUR-FUNCTION-SECRET — with your real values before running this.
-- Both also appear in the README with exactly where to find them.
-- ============================================================

-- ---- 1. Where each device's push subscription is stored -----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: manage own" on public.push_subscriptions;
create policy "push_subscriptions: manage own"
  on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "push_subscriptions: admin can view" on public.push_subscriptions;
create policy "push_subscriptions: admin can view"
  on public.push_subscriptions for select
  using (public.is_admin());

-- ---- 2. Dedup log for the two scheduled notification types ---------
-- Prevents the follow-up-time reminder or the morning digest from
-- ever sending twice for the same lead/agent/day, even if the
-- scheduled job runs more than once around the same time. New-lead
-- alerts don't need this — they fire directly off a single row change,
-- not a repeating schedule.
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  lead_id uuid references public.leads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  sent_for_date date not null default current_date,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_log_followup_uidx
  on public.notification_log(lead_id, sent_for_date)
  where kind = 'followup_time';

create unique index if not exists notification_log_digest_uidx
  on public.notification_log(user_id, sent_for_date)
  where kind = 'morning_digest';

alter table public.notification_log enable row level security;
-- No client-facing policies on purpose — only the Edge Functions
-- (using the service role key, which bypasses RLS) ever touch this.

-- ---- 3. Instant "new lead assigned" trigger -------------------------
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_new_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null and (old is null or old.assigned_to is distinct from new.assigned_to) then
    perform net.http_post(
      url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-new-lead',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'YOUR-FUNCTION-SECRET'),
      body := jsonb_build_object('record', to_jsonb(new), 'old_record', case when old is null then null else to_jsonb(old) end)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_new_lead on public.leads;
create trigger trg_notify_new_lead
  after insert or update of assigned_to on public.leads
  for each row execute function public.notify_new_lead_assignment();

-- ---- 4. Scheduled reminders ------------------------------------------
create extension if not exists pg_cron with schema extensions;

-- Follow-up time reminders — checks every 15 minutes for any follow-up
-- whose specific time just came due.
select cron.schedule(
  'send-followup-time-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-followup-time',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'YOUR-FUNCTION-SECRET'),
    body := '{}'::jsonb
  );
  $$
);

-- Morning digest — once a day at 8:00 AM IST (= 02:30 UTC). Change the
-- '30 2' below to adjust the time (cron time is in UTC, IST is UTC+5:30).
select cron.schedule(
  'send-morning-digest',
  '30 2 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-morning-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'YOUR-FUNCTION-SECRET'),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- Done. See the README's "Push Notifications" section for the Edge
-- Function code to deploy and the secrets to set before this will
-- actually send anything.
-- ============================================================
