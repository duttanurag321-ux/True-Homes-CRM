-- ============================================================
-- PROJECT-BASED AUTOMATIC ASSIGNMENT
-- Safe to run more than once. Changes no existing data.
-- ============================================================

create table if not exists public.project_agents (
  project text not null,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project, agent_id)
);

create table if not exists public.project_round_robin (
  project text primary key,
  last_agent_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.project_agents enable row level security;
alter table public.project_round_robin enable row level security;

drop policy if exists "project_agents: admin all" on public.project_agents;
create policy "project_agents: admin all"
  on public.project_agents for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "project_round_robin: admin view" on public.project_round_robin;
create policy "project_round_robin: admin view"
  on public.project_round_robin for select
  using (public.is_admin());

-- Next agent for a project. Project has a rule -> rotate only among its
-- selected agents who have "Receiving Leads" on (null if none available).
-- No rule -> the normal global round robin, exactly as before.
create or replace function public.get_next_agent_for_project(p_project text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := lower(btrim(coalesce(p_project, '')));
  has_rule boolean;
  ids uuid[];
  last_id uuid;
  last_idx int;
  next_id uuid;
begin
  if k = '' then
    return public.get_next_import_agent();
  end if;

  select exists (select 1 from public.project_agents where lower(btrim(project)) = k)
    into has_rule;
  if not has_rule then
    return public.get_next_import_agent();
  end if;

  insert into public.project_round_robin (project) values (k) on conflict (project) do nothing;
  select last_agent_id into last_id from public.project_round_robin where project = k for update;

  select array_agg(p.id order by p.created_at, p.id) into ids
  from public.profiles p
  join public.project_agents pa on pa.agent_id = p.id and lower(btrim(pa.project)) = k
  where p.role = 'agent' and p.receiving_leads = true;

  if ids is null or array_length(ids, 1) = 0 then
    return null;
  end if;

  last_idx := array_position(ids, last_id);
  if last_idx is null or last_idx >= array_length(ids, 1) then
    next_id := ids[1];
  else
    next_id := ids[last_idx + 1];
  end if;

  update public.project_round_robin set last_agent_id = next_id, updated_at = now() where project = k;
  return next_id;
end;
$$;

-- New leads: a project WITH a rule is always routed by that rule (even if
-- the global Automatic Round Robin switch is off). Others follow the switch.
create or replace function public.auto_assign_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  enabled boolean;
  has_rule boolean := false;
begin
  if new.assigned_to is not null then
    return new;
  end if;

  if coalesce(btrim(new.project), '') <> '' then
    select exists (
      select 1 from public.project_agents
      where lower(btrim(project)) = lower(btrim(new.project))
    ) into has_rule;
  end if;

  if has_rule then
    new.assigned_to := public.get_next_agent_for_project(new.project);
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

-- Admin screen data: every project name + its selected agents (one small call).
create or replace function public.admin_project_rules()
returns table (project text, agent_ids uuid[])
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return query
  with names as (
    select distinct btrim(l.project) as project from public.leads l where coalesce(btrim(l.project), '') <> ''
    union
    select distinct btrim(pa.project) from public.project_agents pa
  )
  select n.project,
         coalesce((select array_agg(pa.agent_id) from public.project_agents pa
                   where lower(btrim(pa.project)) = lower(n.project)), '{}'::uuid[])
  from names n
  order by n.project;
end;
$$;

-- Save the agents for one project. Empty list = remove the rule.
create or replace function public.set_project_agents(p_project text, p_agent_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  delete from public.project_agents where lower(btrim(project)) = lower(btrim(p_project));
  if p_agent_ids is not null and array_length(p_agent_ids, 1) > 0 then
    insert into public.project_agents (project, agent_id)
    select btrim(p_project), unnest(p_agent_ids)
    on conflict do nothing;
  end if;
end;
$$;
