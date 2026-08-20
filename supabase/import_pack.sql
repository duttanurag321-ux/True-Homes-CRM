-- ============================================================
-- IMPORT PACK — automatic Facebook-sheet lead import
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Safe to run on your existing project — only adds things, never
-- drops or rewrites your existing tables/policies.
-- ============================================================

-- ---- 1. Reliable phone-based dedup -----------------------------
-- Phones in the sheet/CRM can be typed with spaces, +91, a leading 0,
-- etc. Comparing the raw `phone` column would let obvious duplicates
-- slip through. This adds a generated column that always holds just
-- the last 10 digits, so "9876543210", "+91 98765 43210" and
-- "098765-43210" all normalize to the same value and can be matched
-- reliably — nothing about the existing `phone` column changes.
alter table public.leads
  add column if not exists phone_digits text
  generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored;

create index if not exists leads_phone_digits_idx on public.leads(phone_digits);

-- ---- 2. Round-robin distribution state --------------------------
-- A single-row table that remembers who got the last imported lead,
-- so distribution stays fair even if the Apps Script stops and
-- restarts (nothing is kept in memory anywhere).
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

-- Admins can look at it from the app if useful; nobody else needs to —
-- the importer talks to Supabase with the service_role key, which
-- bypasses RLS entirely, so this policy is only about in-app visibility.
create policy "import_round_robin: admins can view"
  on public.import_round_robin for select
  using (public.is_admin());

-- ---- 3. Atomic "give me the next agent" function -----------------
-- Doing this as a single locked database function (instead of the
-- Apps Script reading the last agent, then writing the new one in a
-- separate step) means two overlapping script runs can never hand out
-- the same "next" agent — the row lock makes each call wait its turn.
-- Agents are read fresh from `profiles` every call, ordered by
-- `created_at`, so adding/removing an agent later just changes the
-- rotation on the next call — nothing to update by hand.
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
  -- Lock the single state row for the duration of this call so
  -- concurrent script runs serialize instead of racing.
  select last_agent_id into last_id from public.import_round_robin where id = 1 for update;

  select array_agg(id order by created_at, id)
    into agent_ids
  from public.profiles
  where role = 'agent';

  if agent_ids is null or array_length(agent_ids, 1) = 0 then
    return null; -- no agents to assign to — caller should handle this
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

-- ---- 4. Realtime, so an assigned agent sees a new lead live -----
-- Adds `leads` to the realtime publication if it isn't already in
-- there (Supabase projects created after ~2023 usually have this on
-- by default for tables you add via the dashboard, but this makes
-- sure explicitly). Safe to run even if it's already added.
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
-- Done. Next: set up the Google Apps Script (see README / setup
-- instructions) with your Project URL and service_role key, point it
-- at your Google Sheet, and run `importNewLeads` once manually to
-- test before turning on the time-driven trigger.
-- ============================================================
