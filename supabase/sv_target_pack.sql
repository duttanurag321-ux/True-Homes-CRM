-- ============================================================
-- SV TARGET PACK — a persisted, admin-configurable monthly Site
-- Visit target for the Home dashboard's progress ring.
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Safe to run on your existing project — only adds one small table.
-- No changes to leads/activities: the dashboard counts completed
-- Site Visits from the existing "SV Done" pipeline stage, the same
-- source of truth the SV Report already uses.
-- ============================================================

-- A single-row settings table (same singleton pattern as
-- import_round_robin from an earlier pack). If per-agent targets are
-- ever needed later, that's a small additive change — e.g. a nullable
-- sv_monthly_target column on profiles that overrides this global
-- default when set — nothing here needs to change for that.
create table if not exists public.app_settings (
  id int primary key default 1,
  sv_monthly_target int not null default 12,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1),
  constraint app_settings_target_positive check (sv_monthly_target > 0)
);

insert into public.app_settings (id, sv_monthly_target)
values (1, 12)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Every logged-in user (agent or admin) needs to read the target so
-- their own dashboard ring can show "X of Y" — it's not sensitive data.
drop policy if exists "app_settings: any authenticated user can view" on public.app_settings;
create policy "app_settings: any authenticated user can view"
  on public.app_settings for select
  using (auth.uid() is not null);

-- Only admins can change it.
drop policy if exists "app_settings: admin can update" on public.app_settings;
create policy "app_settings: admin can update"
  on public.app_settings for update
  using (public.is_admin());

-- ============================================================
-- Done. Completed Site Visits are still derived entirely from the
-- existing "sv_done" pipeline stage — nothing new to maintain there.
-- ============================================================
