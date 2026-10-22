-- ============================================================
--  Chat plans: monthly retainer with an included message allowance
--  (first client: Women's Financial Wellness Center, $250/mo incl.
--  2,000 messages, $0.04 per message over). Run once in the Supabase
--  SQL editor. Every statement is idempotent.
--
--  NOTE: supabase/schema.sql is the original frozen schema; columns
--  added since (pod_agents, label, notification_email, drive_folder_id,
--  billing_starts_at, chat_rate_per_message_cents, message_count,
--  agent_label, email_sent_at) were applied by hand. This file is the
--  first tracked migration.
-- ============================================================

-- 'voice' pods show calls/minutes; 'chat' pods show conversations/messages.
alter table public.clients
  add column if not exists channel text not null default 'voice';

-- Messages included in the monthly retainer (0 = none; usage billed from the first message).
alter table public.clients
  add column if not exists included_messages_per_month integer not null default 0;

-- What counts as one message for metering: 'agent' (assistant turns only,
-- mirrors Retell's own cost basis) or 'all' (assistant + user turns).
alter table public.clients
  add column if not exists message_basis text not null default 'agent';

-- 'webhook' (default): rows arrive live from the agent webhook; the cron only
-- heals misses and alerts. 'poll': the agent's webhook belongs to another
-- service, so the cron is the primary ingestion path (no alerts, no emails).
alter table public.clients
  add column if not exists ingest_mode text not null default 'webhook';

-- Which Retell channel the agent is on, so the cron knows whether to list
-- calls or chats for it.
alter table public.pod_agents
  add column if not exists channel text not null default 'voice';

-- Chat rows: user turns stored alongside the metered count so the basis can
-- be changed later without re-fetching from Retell.
alter table public.calls
  add column if not exists user_message_count integer;

-- Chat status from Retell ('ongoing' | 'ended' | 'error'); polled chats are
-- re-upserted while ongoing so message counts keep growing.
alter table public.calls
  add column if not exists chat_status text;

alter table public.clients
  drop constraint if exists clients_channel_check,
  add constraint clients_channel_check check (channel in ('voice', 'chat'));
alter table public.clients
  drop constraint if exists clients_message_basis_check,
  add constraint clients_message_basis_check check (message_basis in ('agent', 'all'));
alter table public.clients
  drop constraint if exists clients_ingest_mode_check,
  add constraint clients_ingest_mode_check check (ingest_mode in ('webhook', 'poll'));
alter table public.pod_agents
  drop constraint if exists pod_agents_channel_check,
  add constraint pod_agents_channel_check check (channel in ('voice', 'chat'));

-- Campbell's website chat agent is a chat agent; keep the cron honest.
update public.pod_agents set channel = 'chat'
  where retell_agent_id = 'agent_f002cf629535d9e9f27627559e';
