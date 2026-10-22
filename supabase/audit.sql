-- ============================================================
--  SUPABASE AUDIT — read-only, safe to run any time.
--  Paste each section into the Supabase SQL editor and run it.
--  Nothing here modifies data. Use the results to decide what
--  to drop in cleanup.sql.
--
--  The app needs exactly these tables (the KEEP list):
--    public.clients, public.profiles, public.calls,
--    public.invoices, public.usage_events, public.pod_agents
--  Anything else in your database is a leftover experiment.
-- ============================================================

-- ----- 0. total database size (free tier cap: 500 MB) --------
select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- ----- 1. every user table, sized, flagged KEEP or REVIEW ----
-- "REVIEW" = not used by this app; a candidate to drop.
select
  n.nspname || '.' || c.relname                          as table_name,
  pg_size_pretty(pg_total_relation_size(c.oid))          as total_size,
  c.reltuples::bigint                                    as approx_rows,
  case
    when n.nspname = 'public' and c.relname in
      ('clients','profiles','calls','invoices','usage_events','pod_agents')
    then 'KEEP'
    else 'REVIEW — not used by VoiceDesk'
  end                                                    as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')  -- ordinary + partitioned tables
  and n.nspname not in ('pg_catalog','information_schema','pg_toast',
                        'auth','storage','realtime','extensions','vault',
                        'graphql','graphql_public','pgsodium','pgsodium_masks',
                        'supabase_functions','supabase_migrations','net','cron')
order by pg_total_relation_size(c.oid) desc;

-- ----- 2. what's actually heavy inside `calls` ----------------
-- The raw Retell payload + transcript usually dominate. If this
-- shows megabytes you don't need, cleanup.sql has a trim step.
select
  count(*)                                                   as calls,
  pg_size_pretty(coalesce(sum(pg_column_size(raw)), 0))        as raw_payload_size,
  pg_size_pretty(coalesce(sum(pg_column_size(transcript)), 0)) as transcript_size,
  min(started_at)                                            as oldest_call
from public.calls;

-- ----- 3. non-app views, materialized views, functions --------
select n.nspname || '.' || c.relname as name,
       case c.relkind when 'v' then 'view' when 'm' then 'materialized view' end as kind,
       pg_size_pretty(pg_total_relation_size(c.oid)) as size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v','m')
  and n.nspname = 'public';

select p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname not in ('current_client_id','is_admin')  -- the two the app needs
order by p.proname;

-- ----- 4. storage buckets (count against your storage quota) --
select b.name as bucket,
       count(o.id) as files,
       pg_size_pretty(coalesce(sum((o.metadata->>'size')::bigint), 0)) as size
from storage.buckets b
left join storage.objects o on o.bucket_id = b.id
group by b.name
order by coalesce(sum((o.metadata->>'size')::bigint), 0) desc;

-- ----- 5. auth users (free tier: 50k MAU, rarely the problem) --
select count(*) as auth_users from auth.users;

-- ----- 6. dead rows / bloat — tables worth VACUUMing ----------
select relname as table_name,
       n_live_tup as live_rows,
       n_dead_tup as dead_rows,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_stat_user_tables
where schemaname = 'public'
order by n_dead_tup desc;
