-- ============================================================
--  SUPABASE CLEANUP — run audit.sql FIRST and read its output.
--  This file frees space inside THIS project. If your goal is a
--  new free-tier project for Fatrat.ink, see the notes at the
--  bottom — the limit that usually bites is 2 ACTIVE PROJECTS
--  per free org, which no amount of SQL fixes.
--
--  Steps are independent; run only the ones you want.
-- ============================================================

-- ----- STEP 1: preview the drops -----------------------------
-- Generates one DROP statement per table the app doesn't use.
-- It only PRINTS them — copy the ones you agree with into the
-- editor and run them yourself. Don't drop anything you don't
-- recognize from audit.sql without checking it's empty first.
select format('drop table if exists %I.%I cascade;', schemaname, tablename) as run_me_if_sure
from pg_tables
where schemaname = 'public'
  and tablename not in ('clients','profiles','calls','invoices','usage_events','pod_agents');

-- Same for leftover views:
select format('drop view if exists public.%I cascade;', viewname) as run_me_if_sure
from pg_views
where schemaname = 'public';

-- Same for leftover functions (keeps the two RLS helpers):
select format('drop function if exists public.%I(%s) cascade;',
              p.proname, pg_get_function_identity_arguments(p.oid)) as run_me_if_sure
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname not in ('current_client_id','is_admin');

-- ----- STEP 2 (optional): trim heavyweight call data ----------
-- calls.raw is the full Retell payload, kept "for debugging".
-- If audit.sql section 2 showed it's big, null it out for calls
-- older than 90 days — billing math never reads it back.
-- update public.calls
--   set raw = null
--   where started_at < now() - interval '90 days'
--     and raw is not null;

-- ----- STEP 3: reclaim the disk space -------------------------
-- Postgres doesn't return space to the OS until you VACUUM FULL.
-- Supabase's reported DB size only shrinks after this. It takes
-- a brief exclusive lock per table — fine at your scale.
-- Run after any drops/trims above:
vacuum full;

-- Re-check the result:
select pg_size_pretty(pg_database_size(current_database())) as database_size_after;

-- ----- STEP 4: storage buckets --------------------------------
-- Bucket files count against a separate 1 GB storage quota.
-- Empty/delete unused buckets in Dashboard → Storage (deleting
-- objects via SQL doesn't remove the underlying files).

-- ============================================================
--  MAKING ROOM FOR FATRAT.INK — the actual free-tier math
-- ============================================================
--  The free plan allows 2 ACTIVE projects per organization, and
--  each project gets its own 500 MB database. So:
--
--  Option A — free up a project slot (cleanest):
--    Dashboard → your old/abandoned projects → Settings →
--    General → pause or delete. Deleting an unused project
--    instantly gives Fatrat.ink its own isolated project with a
--    fresh 500 MB. Nothing in this file is needed for that.
--
--  Option B — share this project's Postgres (no slot needed):
--    Put Fatrat.ink in its own schema next to VoiceDesk. Fully
--    isolated tables/RLS, same connection:
--
--      create schema if not exists fatrat;
--      grant usage on schema fatrat to anon, authenticated, service_role;
--      alter default privileges in schema fatrat
--        grant all on tables to anon, authenticated, service_role;
--
--    Then add `fatrat` to Dashboard → Settings → API →
--    "Exposed schemas" and query it with
--    `supabase.schema('fatrat').from('...')`.
--    Caveat: shared 500 MB, shared auth.users, and a pause/
--    outage hits both apps. Fine for starting out; move it to
--    its own project (Option A) when it grows.
