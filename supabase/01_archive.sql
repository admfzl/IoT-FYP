-- ============================================================================
-- Fish Feeder v2 — Step 1 of 2: archive the v1 tables (NO data is deleted)
--
-- BEFORE RUNNING: download your current LIVE CSV from the old dashboard
-- ("Export LIVE CSV") and keep it somewhere safe, even though this script only
-- renames tables.
--
-- What this does:
--   * Renames every v1 table to legacy_<name>_20261113 (data preserved).
--   * Renames the v1 index so the name is free for reuse.
--   * Drops the v1 functions (reserve_portion, refund_portion, refill_hopper).
--
-- Safe to run more than once: each step checks whether the object exists.
-- Paste into Supabase -> SQL Editor -> Run. Then run 02_schema.sql.
-- ============================================================================

do $$
declare
  v_suffix constant text := '20261113';
  v_table text;
begin
  foreach v_table in array array['feed_logs', 'feeder_state'] loop
    if to_regclass('public.' || v_table) is not null
       and to_regclass('public.legacy_' || v_table || '_' || v_suffix) is null then
      execute format('alter table public.%I rename to %I', v_table, 'legacy_' || v_table || '_' || v_suffix);
      raise notice 'Archived public.% -> public.legacy_%_%', v_table, v_table, v_suffix;
    end if;
  end loop;

  if to_regclass('public.idx_feed_logs_origin_created_at') is not null then
    execute 'alter index public.idx_feed_logs_origin_created_at rename to legacy_idx_feed_logs_origin_created_at_' || v_suffix;
  end if;
end $$;

drop function if exists public.reserve_portion();
drop function if exists public.refund_portion();
drop function if exists public.refill_hopper();

-- Keep the archived tables locked down (RLS on, no policies -> service role only).
do $$
begin
  if to_regclass('public.legacy_feed_logs_20261113') is not null then
    execute 'alter table public.legacy_feed_logs_20261113 enable row level security';
  end if;
  if to_regclass('public.legacy_feeder_state_20261113') is not null then
    execute 'alter table public.legacy_feeder_state_20261113 enable row level security';
  end if;
end $$;

