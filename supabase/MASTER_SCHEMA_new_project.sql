-- ============================================================
-- TRUE HOMES CRM — MASTER SCHEMA (fresh project)
-- Run this ONCE, top to bottom, in a brand-new Supabase project's
-- SQL Editor. This is the consolidated final state of everything
-- built for this CRM — equivalent to running every pack file in
-- order, but with nothing superseded left in, and no placeholder
-- values that needed replacing along the way (except the two
-- specifically marked below, which need YOUR new project's info).
-- ============================================================

-- ============================================================
-- 1. PROFILES
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'agent' check (role in ('agent','admin')),
  streak_count int not null default 0,
  last_completed_date date,
  receiving_leads boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles: read own or admin reads all" on public.profiles;
create policy "profiles: read own or admin reads all"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: authenticated users can view teammates" on public.profiles;
create policy "profiles: authenticated users can view teammates"
  on public.profiles for select
  using (auth.uid() is not null);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid());

drop policy if exists "profiles: admin can update any" on public.profiles;
create policy "profiles: admin can update any"
  on public.profiles for update
  using (public.is_admin());

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 2. LEADS
-- ============================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  source text,
  profession text,
  budget_min numeric,
  budget_max numeric,
  sqft numeric,
  katha numeric,
  location_preference text,
  purpose text,
  notes text,
  status text not null default 'new',
  call_status text,
  next_action text,
  next_followup_date date,
  next_followup_time time,
  last_contacted_at timestamptz,
  created_by uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  origin text not null default 'app' check (origin in ('app', 'facebook', 'csv_import')),

  meta_lead_id text,
  meta_ad_id text,
  meta_ad_name text,
  meta_adset_id text,
  meta_adset_name text,
  meta_campaign_id text,
  meta_campaign_name text,
  meta_form_id text,
  meta_form_name text,
  meta_created_time timestamptz,
  meta_is_organic boolean,
  meta_platform text,

  qualified_at timestamptz,
  site_visit_at timestamptz,
  booking_at timestamptz,
  qualified_event_sent boolean not null default false,
  site_visit_event_sent boolean not null default false,
  booking_event_sent boolean not null default false,

  phone_digits text generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_next_followup_idx on public.leads(next_followup_date);
create index if not exists leads_phone_digits_idx on public.leads(phone_digits);
create index if not exists leads_origin_idx on public.leads(origin);
create index if not exists leads_meta_lead_id_idx on public.leads(meta_lead_id);

alter table public.leads enable row level security;

drop policy if exists "leads: agents see their own, admins see all" on public.leads;
create policy "leads: agents see their own, admins see all"
  on public.leads for select
  using (assigned_to = auth.uid() or public.is_admin());

drop policy if exists "leads: agents insert for themselves" on public.leads;
create policy "leads: agents insert for themselves"
  on public.leads for insert
  with check (created_by = auth.uid());

drop policy if exists "leads: agents update their own, admins update all" on public.leads;
create policy "leads: agents update their own, admins update all"
  on public.leads for update
  using (assigned_to = auth.uid() or public.is_admin());

drop policy if exists "leads: admins can delete" on public.leads;
create policy "leads: admins can delete"
  on public.leads for delete
  using (public.is_admin());

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- 3. ACTIVITIES
-- ============================================================
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  type text not null default 'call',
  call_outcome text,
  stage_at_time text,
  next_action text,
  followup_date date,
  followup_time time,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists activities_lead_id_idx on public.activities(lead_id);
create index if not exists activities_user_id_idx on public.activities(user_id);
create index if not exists activities_created_at_idx on public.activities(created_at);
create index if not exists activities_stage_idx on public.activities(stage_at_time);

alter table public.activities enable row level security;

drop policy if exists "activities: see own, admins see all" on public.activities;
create policy "activities: see own, admins see all"
  on public.activities for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "activities: insert own" on public.activities;
create policy "activities: insert own"
  on public.activities for insert
  with check (user_id = auth.uid());

-- ============================================================
-- 4. IMPORT ROUND ROBIN
-- ============================================================
create table if not exists public.import_round_robin (
  id int primary key default 1,
  last_agent_id uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint import_round_robin_singleton check (id = 1)
);

insert into public.import_round_robin (id, last_agent_id)
values (1, null)
on conflict (id) do nothing;

alter table public.import_round_robin enable row level security;

drop policy if exists "import_round_robin: admins can view" on public.import_round_robin;
create policy "import_round_robin: admins can view"
  on public.import_round_robin for select
  using (public.is_admin());

create or replace function public.get_next_import_agent()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  agent_ids uuid[];
  last_id uuid;
  next_id uuid;
  last_idx int;
begin
  select last_agent_id into last_id from public.import_round_robin where id = 1 for update;

  select array_agg(id order by created_at, id)
    into agent_ids
  from public.profiles
  where role = 'agent' and receiving_leads = true;

  if agent_ids is null or array_length(agent_ids, 1) = 0 then
    return null;
  end if;

  last_idx := array_position(agent_ids, last_id);

  if last_idx is null or last_idx >= array_length(agent_ids, 1) then
    next_id := agent_ids[1];
  else
    next_id := agent_ids[last_idx + 1];
  end if;

  update public.import_round_robin set last_agent_id = next_id, updated_at = now() where id = 1;

  return next_id;
end;
$$;

-- ============================================================
-- 5. APP SETTINGS
-- ============================================================
create table if not exists public.app_settings (
  id int primary key default 1,
  sv_monthly_target int not null default 12,
  auto_assign_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1),
  constraint app_settings_target_positive check (sv_monthly_target > 0)
);

insert into public.app_settings (id, sv_monthly_target)
values (1, 12)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings: any authenticated user can view" on public.app_settings;
create policy "app_settings: any authenticated user can view"
  on public.app_settings for select
  using (auth.uid() is not null);

drop policy if exists "app_settings: admin can update" on public.app_settings;
create policy "app_settings: admin can update"
  on public.app_settings for update
  using (public.is_admin());

create or replace function public.auto_assign_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  enabled boolean;
begin
  if new.assigned_to is not null then
    return new;
  end if;

  select auto_assign_enabled into enabled from public.app_settings where id = 1;
  if coalesce(enabled, false) then
    new.assigned_to := public.get_next_import_agent();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_assign_new_lead on public.leads;
create trigger trg_auto_assign_new_lead
  before insert on public.leads
  for each row execute function public.auto_assign_new_lead();

-- ============================================================
-- 6. LEAD REASSIGNMENTS + transfer_lead()
-- ============================================================
create table if not exists public.lead_reassignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_agent uuid references public.profiles(id),
  to_agent uuid references public.profiles(id),
  reassigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists lead_reassignments_lead_idx on public.lead_reassignments(lead_id);
create index if not exists lead_reassignments_to_idx on public.lead_reassignments(to_agent);

alter table public.lead_reassignments enable row level security;

drop policy if exists "lead_reassignments: admins see all" on public.lead_reassignments;
create policy "lead_reassignments: admins see all"
  on public.lead_reassignments for select
  using (public.is_admin());

drop policy if exists "lead_reassignments: admins insert" on public.lead_reassignments;
create policy "lead_reassignments: admins insert"
  on public.lead_reassignments for insert
  with check (public.is_admin());

drop policy if exists "lead_reassignments: agents log their own transfers" on public.lead_reassignments;
create policy "lead_reassignments: agents log their own transfers"
  on public.lead_reassignments for insert
  with check (reassigned_by = auth.uid());

create or replace function public.transfer_lead(p_lead_id uuid, p_to_agent uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_agent uuid;
  v_caller uuid := auth.uid();
begin
  select assigned_to into v_from_agent from public.leads where id = p_lead_id;

  if v_from_agent is null and not exists (select 1 from public.leads where id = p_lead_id) then
    raise exception 'Lead not found.';
  end if;

  if not (public.is_admin() or v_from_agent = v_caller) then
    raise exception 'You can only transfer leads currently assigned to you.';
  end if;

  update public.leads set assigned_to = p_to_agent where id = p_lead_id;

  insert into public.lead_reassignments (lead_id, from_agent, to_agent, reassigned_by)
  values (p_lead_id, v_from_agent, p_to_agent, v_caller);
end;
$$;

grant execute on function public.transfer_lead(uuid, uuid) to authenticated;

-- ============================================================
-- 7. PUSH NOTIFICATIONS
-- ============================================================
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

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  lead_id uuid references public.leads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  sent_for_date date not null default current_date,
  detail text,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_log_followup_uidx
  on public.notification_log(lead_id, sent_for_date, detail)
  where kind = 'followup_time';

create unique index if not exists notification_log_digest_uidx
  on public.notification_log(user_id, sent_for_date)
  where kind = 'morning_digest';

create unique index if not exists notification_log_overdue_uidx
  on public.notification_log(lead_id, sent_for_date)
  where kind = 'overdue_nudge';

alter table public.notification_log enable row level security;

create extension if not exists pg_net with schema extensions;

-- ⚠ PLACEHOLDER — you'll replace YOUR-PROJECT-REF and YOUR-FUNCTION-SECRET
-- with your NEW project's real values in the setup steps (same two
-- placeholders as before, just for the new project this time).
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

-- ============================================================
-- 8. META CONVERSIONS API
-- ============================================================
create table if not exists public.meta_conversion_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null check (event_type in ('Qualified', 'SiteVisit', 'Booking')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (lead_id, event_type)
);

create index if not exists meta_conversion_events_status_idx on public.meta_conversion_events(status);

alter table public.meta_conversion_events enable row level security;

drop policy if exists "meta_conversion_events: admins can view" on public.meta_conversion_events;
create policy "meta_conversion_events: admins can view"
  on public.meta_conversion_events for select
  using (public.is_admin());

create or replace function public.enqueue_meta_conversion_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.call_status = 'IN' and (old.call_status is distinct from 'IN') then
    if new.qualified_at is null then
      new.qualified_at := now();
    end if;
    insert into public.meta_conversion_events (lead_id, event_type)
    values (new.id, 'Qualified')
    on conflict (lead_id, event_type) do nothing;
  end if;

  if new.status = 'sv_done' and (old.status is distinct from 'sv_done') then
    if new.site_visit_at is null then
      new.site_visit_at := now();
    end if;
    insert into public.meta_conversion_events (lead_id, event_type)
    values (new.id, 'SiteVisit')
    on conflict (lead_id, event_type) do nothing;
  end if;

  if new.status = 'won' and (old.status is distinct from 'won') then
    if new.booking_at is null then
      new.booking_at := now();
    end if;
    insert into public.meta_conversion_events (lead_id, event_type)
    values (new.id, 'Booking')
    on conflict (lead_id, event_type) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_meta_conversion_events on public.leads;
create trigger trg_enqueue_meta_conversion_events
  before update on public.leads
  for each row execute function public.enqueue_meta_conversion_events();

-- ============================================================
-- 9. REALTIME
-- Only `leads` needs this — the activities-table and unfiltered
-- leads-table realtime subscriptions that used to exist in the app
-- were removed already (they were a major cause of the egress
-- overage). The one remaining subscription is filtered to
-- "assigned_to = me" per user, which is lightweight.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;

-- ============================================================
-- DONE. Next: Authentication → Providers → confirm Email is on.
-- Authentication → Settings → turn OFF "Confirm email" so agents can
-- sign in immediately. Then see the migration steps for importing
-- your existing data and getting everyone's accounts moved over.
-- ============================================================
