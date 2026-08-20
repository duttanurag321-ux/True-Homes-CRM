-- ============================================================
-- Broker CRM — Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. PROFILES ---------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'agent' check (role in ('agent','admin')),
  streak_count int not null default 0,
  last_completed_date date,
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

create policy "profiles: read own or admin reads all"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid());

create policy "profiles: insert own"
  on public.profiles for insert
  with check (id = auth.uid());

-- Auto-create a profile row whenever someone signs up
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

-- 2. LEADS --------------------------------------------------------
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
  notes text,
  status text not null default 'new',
  call_status text,
  next_action text,
  next_followup_date date,
  next_followup_time time,
  last_contacted_at timestamptz,
  created_by uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_assigned_to_idx on public.leads(assigned_to);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_next_followup_idx on public.leads(next_followup_date);

alter table public.leads enable row level security;

create policy "leads: agents see their own, admins see all"
  on public.leads for select
  using (assigned_to = auth.uid() or public.is_admin());

create policy "leads: agents insert for themselves"
  on public.leads for insert
  with check (created_by = auth.uid());

create policy "leads: agents update their own, admins update all"
  on public.leads for update
  using (assigned_to = auth.uid() or public.is_admin());

create policy "leads: admins can delete"
  on public.leads for delete
  using (public.is_admin());

-- 3. ACTIVITIES (call log / follow-up history) ---------------------
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

create policy "activities: see own, admins see all"
  on public.activities for select
  using (user_id = auth.uid() or public.is_admin());

create policy "activities: insert own"
  on public.activities for insert
  with check (user_id = auth.uid());

-- Keep updated_at fresh on leads
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
-- Done. Next: Authentication → Providers → make sure Email is
-- enabled, and (recommended for a small team) turn OFF
-- "Confirm email" under Authentication → Settings so new agents
-- can sign in immediately after creating an account.
-- ============================================================
