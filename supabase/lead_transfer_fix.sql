-- ============================================================
-- LEAD TRANSFER FIX — replaces the row-policy approach for peer
-- transfers with a single atomic function.
--
-- What was going wrong: right after an UPDATE, Postgres also checks
-- the changed row against the table's SELECT policy before handing it
-- back to the app. Once a lead's `assigned_to` changes to someone
-- else, the agent doing the transfer can no longer see that lead
-- under the normal "agents see their own" rule — so Postgres blocked
-- the whole update over that, even though the actual transfer
-- permission was fine. This sidesteps that entirely: the transfer now
-- happens inside one function that runs with full access, checks
-- permission itself, and never hands a "no longer visible to you" row
-- back to the client.
--
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- ============================================================

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

-- The two update policies added earlier for this feature are no longer
-- needed — the function above handles permission-checking itself and
-- runs with its own access, bypassing RLS safely. Leaving the old
-- "agents update their own, admins update all" behavior exactly as it
-- always was for everything else (editing notes, stage, etc.).
drop policy if exists "leads: owner can reassign to a teammate" on public.leads;
drop policy if exists "leads: agents update their own or admins update all" on public.leads;

drop policy if exists "leads: agents update their own, admins update all" on public.leads;
create policy "leads: agents update their own, admins update all"
  on public.leads for update
  using (assigned_to = auth.uid() or public.is_admin());

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Done. Also upload the updated LeadDetail.jsx from this same update
-- — it now calls this function instead of updating the lead directly.
-- ============================================================
