-- ============================================================
-- LEAD PURPOSE PACK — adds a "purpose" field to leads (residential /
-- investment / commercial etc.), filled in from the Log Call sheet
-- after the first real conversation.
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Safe to run on your existing project — only adds a column.
-- ============================================================

alter table public.leads
  add column if not exists purpose text;

-- ============================================================
-- Done. No RLS changes needed — it's covered by the existing
-- leads select/update policies.
-- ============================================================
