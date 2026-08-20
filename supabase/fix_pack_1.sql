-- ============================================================
-- FIX PACK 1 — run this in Supabase SQL Editor on your existing
-- project. Safe to run even though your tables already exist.
-- ============================================================

-- ---- 1. Fix "infinite recursion detected in policy for relation profiles" ----
-- Root cause: the profiles policies queried the profiles table from
-- inside their own policy check, which is a cycle. The fix is to
-- move that check into a SECURITY DEFINER function, which runs
-- outside of RLS and breaks the cycle.

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

-- Recreate profiles policies using the function instead of a self-join
drop policy if exists "profiles: read own or admin reads all" on public.profiles;
create policy "profiles: read own or admin reads all"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid());

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (id = auth.uid());

-- Recreate leads / activities policies to use the same function
-- (not strictly required for the recursion bug, but keeps things
-- consistent and a little faster).
drop policy if exists "leads: agents see their own, admins see all" on public.leads;
create policy "leads: agents see their own, admins see all"
  on public.leads for select
  using (assigned_to = auth.uid() or public.is_admin());

drop policy if exists "leads: agents update their own, admins update all" on public.leads;
create policy "leads: agents update their own, admins update all"
  on public.leads for update
  using (assigned_to = auth.uid() or public.is_admin());

drop policy if exists "leads: admins can delete" on public.leads;
create policy "leads: admins can delete"
  on public.leads for delete
  using (public.is_admin());

drop policy if exists "activities: see own, admins see all" on public.activities;
create policy "activities: see own, admins see all"
  on public.activities for select
  using (user_id = auth.uid() or public.is_admin());

-- ---- 2. New / changed lead fields ----
-- Plots-only broker: drop apartment/villa property type in favour of
-- plot size fields, add profession, keep budget_max only.

alter table public.leads drop column if exists property_type;
alter table public.leads add column if not exists profession text;
alter table public.leads add column if not exists sqft numeric;
alter table public.leads add column if not exists katha numeric;

-- budget_min/budget_max were already optional — no change needed there.
-- location_preference was already optional at the column level; the
-- "required after first call" rule is enforced in the app, not the DB,
-- since it depends on *when* the lead was contacted, not a fixed rule.

-- ============================================================
-- Done. After running this, refresh your app — the "infinite
-- recursion" error and blank name on login should both be gone,
-- since both were caused by the same broken policy.
-- ============================================================
