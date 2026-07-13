-- ============================================================
--  Voice AI Client Dashboard — FROZEN SCHEMA (the contract)
--  Run this once in the Supabase SQL editor.
--  Every other piece of the app builds against these shapes.
--  Money is stored in INTEGER CENTS to avoid float rounding.
-- ============================================================

-- ----- enums -------------------------------------------------
create type billing_mode as enum ('per_minute', 'monthly_plus_usage');
create type user_role     as enum ('admin', 'client');
create type invoice_status as enum ('open', 'paid', 'void', 'uncollectible');

-- ----- 1. clients (the "pods") -------------------------------
create table public.clients (
  id                      uuid primary key default gen_random_uuid(),
  name                    text        not null,
  slug                    text        not null unique,          -- used in the URL: /acme-plumbing
  retell_agent_id         text,                                  -- which Retell agent feeds this pod
  billing_mode            billing_mode not null default 'per_minute',
  rate_per_minute_cents   integer     not null default 40,       -- what WE charge the client (e.g. 40 = $0.40)
  cost_per_minute_cents   integer     not null default 15,       -- what Retell charges US (for margin math)
  monthly_price_cents     integer     not null default 0,        -- flat retainer, if billing_mode includes it
  stripe_customer_id      text,
  stripe_subscription_id  text,
  status                  text        not null default 'active', -- active | paused | archived
  created_at              timestamptz not null default now()
);

-- ----- 2. profiles (who can log in; links auth.users -> a client)
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  client_id   uuid references public.clients (id) on delete set null,  -- null for admins
  role        user_role   not null default 'client',
  email       text,
  created_at  timestamptz not null default now()
);

-- ----- 3. calls (every call + cost + what we billed) ---------
create table public.calls (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  retell_call_id    text not null unique,            -- UNIQUE = idempotency, never double-insert a call
  call_type         text,                             -- 'phone_call' | 'web_call' etc.
  started_at        timestamptz,
  duration_seconds  integer     not null default 0,
  cost_cents        numeric(12,4) not null default 0,  -- our Retell cost for this call
  billed_cents      numeric(12,4) not null default 0,  -- what the client pays for this call
  from_number       text,
  to_number         text,
  transcript        text,
  recording_url     text,
  sentiment         text,
  disconnect_reason text,
  raw               jsonb,                            -- full Retell payload, for debugging
  created_at        timestamptz not null default now()
);
create index calls_client_started_idx on public.calls (client_id, started_at desc);

-- ----- 4. invoices (monthly rollup; mirrors Stripe) ----------
create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  period_start      date,
  period_end        date,
  total_cents       numeric(12,2) not null default 0,
  status            invoice_status not null default 'open',
  stripe_invoice_id text,
  created_at        timestamptz not null default now()
);

-- ----- 5. usage_events (what we reported to Stripe; idempotency log)
create table public.usage_events (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id) on delete cascade,
  call_id               uuid references public.calls (id) on delete set null,
  minutes               numeric(10,4) not null default 0,
  stripe_meter_event_id text unique,                  -- UNIQUE = never report the same usage twice
  reported_at           timestamptz not null default now()
);

-- ----- 6. pod_agents (a pod can own MANY Retell agents) ------
--  Maps retell_agent_id -> pod. The webhook resolves calls through
--  this first, falling back to clients.retell_agent_id (legacy).
create table if not exists public.pod_agents (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  retell_agent_id  text not null unique,
  agent_name       text,
  label            text,                              -- per-agent display label in the call log
  created_at       timestamptz not null default now()
);

-- ----- 7. columns added after the original freeze -------------
--  Idempotent: safe to run on an existing database.
alter table public.clients
  add column if not exists retell_api_key               text,     -- per-pod Retell key (fallback: env RETELL_API_KEY)
  add column if not exists chat_rate_per_message_cents  integer not null default 0,
  add column if not exists notification_email           text,     -- call/chat summary emails go here
  add column if not exists drive_folder_id              text;     -- Google Drive folder for transcripts

alter table public.calls
  add column if not exists agent_label    text,        -- which of the pod's agents took it
  add column if not exists message_count  integer,     -- chat sessions: number of messages
  add column if not exists email_sent_at  timestamptz; -- summary-email idempotency marker

-- ============================================================
--  ROW-LEVEL SECURITY  — this is what walls each client off.
--  security-definer helpers avoid recursive policy checks.
-- ============================================================
create or replace function public.current_client_id()
  returns uuid language sql stable security definer set search_path = public as $$
  select client_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

alter table public.clients      enable row level security;
alter table public.profiles     enable row level security;
alter table public.calls        enable row level security;
alter table public.invoices     enable row level security;
alter table public.usage_events enable row level security;
alter table public.pod_agents   enable row level security;

-- admins: full access to everything
create policy admin_all_clients      on public.clients      for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all_profiles     on public.profiles     for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all_calls        on public.calls        for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all_invoices     on public.invoices     for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all_usage        on public.usage_events for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all_pod_agents   on public.pod_agents   for all using (public.is_admin()) with check (public.is_admin());

-- clients: read ONLY their own pod's data
create policy client_read_own_client   on public.clients      for select using (id = public.current_client_id());
create policy client_read_own_profile  on public.profiles     for select using (id = auth.uid());
create policy client_read_own_calls    on public.calls        for select using (client_id = public.current_client_id());
create policy client_read_own_invoices on public.invoices     for select using (client_id = public.current_client_id());
create policy client_read_own_agents   on public.pod_agents   for select using (client_id = public.current_client_id());

-- NOTE: webhooks (Retell/Stripe) write using the service-role key, which BYPASSES RLS by design.
-- Clients have NO insert/update/delete policies, so they can only ever read their own rows.

-- ============================================================
--  ROLE GRANTS — required when applying via the Management API
--  (the dashboard SQL editor applies these automatically; the API does not).
--  RLS still gates anon/authenticated; service_role bypasses RLS.
-- ============================================================
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
