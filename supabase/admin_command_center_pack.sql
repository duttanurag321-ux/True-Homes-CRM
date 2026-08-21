-- ============================================================
-- ADMIN COMMAND CENTER PACK
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Safe on your existing project — only adds a column, a small audit
-- table, and a trigger. Nothing existing is changed or removed.
-- ============================================================

-- ---- 1. The Auto Round Robin switch -------------------------------
alter table public.app_settings
  add column if not exists auto_assign_enabled boolean not null default false;

-- (Read/update policies for app_settings already exist from
-- sv_target_pack.sql — every logged-in user can read it, only admins
-- can change it. This new column is covered automatically.)

-- ---- 2. Auto-assign new leads the instant they're created ---------
-- When the switch above is ON, any lead inserted with no agent already
-- picked (a fresh Facebook lead, or a CSV import left "unassigned")
-- gets handed to the next agent in rotation immediately — it never
-- touches the Lead Pool at all. Reuses the exact same
-- get_next_import_agent() rotation (and the same "Receiving Leads"
-- on/off toggle per agent) that Lead Pool's manual Round Robin already
-- uses, so both stay perfectly consistent with each other.
--
-- When the switch is OFF (default), nothing changes — leads land in
-- the Lead Pool exactly as they do today.
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
    return new; -- already assigned (e.g. an agent adding their own lead) — leave it alone
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

-- ---- 3. Lead reassignment history (Agent A → Agent B) --------------
-- A small log purely for "who moved this lead and when" — separate
-- from `activities` (which is call/pipeline history) because a
-- reassignment isn't a call. Used by the Team page and a lead's own
-- history to show transfers.
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

-- ============================================================
-- Done. Next: Settings → Team has a new "Automatic Round Robin"
-- switch, and Settings → Team also links to the new Team
-- Performance page. See the app README for what each screen does.
-- ============================================================
