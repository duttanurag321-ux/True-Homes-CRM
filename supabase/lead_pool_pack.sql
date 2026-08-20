-- ============================================================
-- LEAD POOL PACK — unassigned Lead Pool, per-agent lead intake
-- toggle, and origin tracking (manual / Facebook / CSV import).
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Safe to run on your existing project — only adds things.
-- Requires import_pack.sql to have been run already (it uses
-- phone_digits and get_next_import_agent from that pack).
-- ============================================================

-- ---- 1. Per-agent "Receiving Leads" toggle -----------------------
alter table public.profiles
  add column if not exists receiving_leads boolean not null default true;

-- Previously only an agent could update their own profile row. An
-- admin now also needs to flip OTHER agents' "Receiving Leads" switch
-- from Settings. This is an additional permissive policy — it doesn't
-- remove the existing "update own" one, it just adds another allowed
-- path (Postgres ORs permissive policies together).
drop policy if exists "profiles: admin can update any" on public.profiles;
create policy "profiles: admin can update any"
  on public.profiles for update
  using (public.is_admin());

-- ---- 2. Where a lead came from -----------------------------------
-- Every existing lead becomes 'app' (typed directly into the CRM),
-- which is accurate for everything already in your database.
alter table public.leads
  add column if not exists origin text not null default 'app'
  check (origin in ('app', 'facebook', 'csv_import'));

create index if not exists leads_origin_idx on public.leads(origin);

-- One-time correction: anything already imported by the Facebook
-- script before this pack existed was tagged only by its `source`
-- value — backfill origin for those so old rows show up correctly
-- in the Lead Pool's Facebook filter too. Safe no-op if you have none.
update public.leads set origin = 'facebook' where origin = 'app' and source ilike 'facebook%';

-- ---- 3. Round robin must skip agents who are toggled OFF ---------
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
    return null; -- nobody is currently receiving leads
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
-- Done. Next: replace the app files listed in the setup
-- instructions, then use Settings → Team to switch agents'
-- "Receiving Leads" on/off, and Leads → Lead Pool to assign
-- unassigned leads.
-- ============================================================
