-- ============================================================
-- STEP 2 — Paste this whole file into Supabase SQL Editor (a NEW
-- query, after Step 1 has finished), click Run.
-- ============================================================

create or replace function public.notify_new_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null and (old is null or old.assigned_to is distinct from new.assigned_to) then
    perform net.http_post(
      url := 'https://hltwmvfljppjkiyimxfh.supabase.co/functions/v1/notify-new-lead',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'th-secret-7k2m9x'),
      body := jsonb_build_object('record', to_jsonb(new), 'old_record', case when old is null then null else to_jsonb(old) end)
    );
  end if;
  return new;
end;
$$;
