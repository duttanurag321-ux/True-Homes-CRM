-- ============================================================
-- META CONVERSIONS API PACK
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Safe on your existing project — only adds columns and a new table,
-- nothing existing is changed or removed.
-- ============================================================

-- ---- 1. Preserve Meta's own attribution data on the lead -----------
-- Everything your Google Sheet already receives from Facebook, carried
-- through onto the lead permanently. Reused wherever possible — this
-- does NOT duplicate `source` (which already exists); it adds the
-- specific Meta identifiers needed to send events back accurately.
alter table public.leads
  add column if not exists meta_lead_id text,
  add column if not exists meta_ad_id text,
  add column if not exists meta_ad_name text,
  add column if not exists meta_adset_id text,
  add column if not exists meta_adset_name text,
  add column if not exists meta_campaign_id text,
  add column if not exists meta_campaign_name text,
  add column if not exists meta_form_id text,
  add column if not exists meta_form_name text,
  add column if not exists meta_created_time timestamptz,
  add column if not exists meta_is_organic boolean,
  add column if not exists meta_platform text;

create index if not exists leads_meta_lead_id_idx on public.leads(meta_lead_id);

-- ---- 2. When each milestone was reached, and whether Meta's been told ----
alter table public.leads
  add column if not exists qualified_at timestamptz,
  add column if not exists site_visit_at timestamptz,
  add column if not exists booking_at timestamptz,
  add column if not exists qualified_event_sent boolean not null default false,
  add column if not exists site_visit_event_sent boolean not null default false,
  add column if not exists booking_event_sent boolean not null default false;

-- ---- 3. The event queue ----------------------------------------------
-- Decouples "this lead just hit a milestone" (instant, always succeeds,
-- pure database work) from "tell Meta about it" (a network call that
-- can fail or be slow) — so the CRM never waits on Meta, and a Meta
-- outage never loses an event, it just sits here until the next retry.
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
-- No insert/update policy for regular users on purpose — only the
-- trigger below (security definer) and the Edge Function (service role)
-- ever write to this table.

-- ---- 4. Automatic enqueue on the milestones that matter --------------
-- Reuses your EXISTING status system — no second status field:
--   Qualified   = call_status becomes 'IN' (Interested) for the first time
--   SiteVisit   = status becomes 'sv_done' for the first time
--   Booking     = status becomes 'won' for the first time
-- Each only ever enqueues once per lead (the UNIQUE constraint above
-- guarantees that, so even if this fires again — the lead's status
-- flaps, or is edited again later — nothing extra gets queued).
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
-- Done. Next: deploy the send-meta-conversions Edge Function and
-- schedule it — see the setup instructions.
-- ============================================================
