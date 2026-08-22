-- ============================================================
-- PEER LEAD TRANSFER PACK — lets any agent hand their own lead to
-- another agent, not just admins.
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Safe on your existing project — only adds policies, changes nothing
-- existing.
-- ============================================================

-- ---- 1. Agents need to see each other's names ---------------------
-- Previously an agent could only see their OWN profile row — fine for
-- everything until now, but the transfer picker needs a list of
-- teammates to choose from. This opens profile SELECT to any signed-in
-- user (name/email/role/receiving_leads — nothing sensitive) as an
-- additional policy; it doesn't remove the existing "own row or admin"
-- one.
drop policy if exists "profiles: authenticated users can view teammates" on public.profiles;
create policy "profiles: authenticated users can view teammates"
  on public.profiles for select
  using (auth.uid() is not null);

-- ---- 2. Let an agent reassign a lead they currently own -------------
-- The existing update policy requires the resulting row to still be
-- assigned to the agent themself (or an admin) — which is exactly
-- right for editing a lead, but silently blocked "hand this lead to a
-- teammate" for anyone but admins. This is a second, narrower policy:
-- an agent may update any lead CURRENTLY assigned to them (that part
-- doesn't change) to ANY new values (that part is new) — it does not
-- grant access to leads that aren't already theirs.
drop policy if exists "leads: owner can reassign to a teammate" on public.leads;
create policy "leads: owner can reassign to a teammate"
  on public.leads for update
  using (assigned_to = auth.uid())
  with check (true);

-- ---- 3. Let an agent log their own transfer in the audit trail ------
drop policy if exists "lead_reassignments: agents log their own transfers" on public.lead_reassignments;
create policy "lead_reassignments: agents log their own transfers"
  on public.lead_reassignments for insert
  with check (reassigned_by = auth.uid());

-- ============================================================
-- Done. The Transfer button on a lead's detail page now works for any
-- agent on their own leads, not just admins. Admins can still see the
-- full transfer history in Settings → Activity Log; agents don't get
-- that log view, only the transfer action itself.
-- ============================================================
