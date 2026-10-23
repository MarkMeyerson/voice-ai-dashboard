-- ============================================================
--  Review fix (docs/review-2026-10-23.md #3, #15)
--  1. Client logins could read every column of their own clients row,
--     including retell_api_key and cost_per_minute_cents, because RLS is
--     row-scoped and `authenticated` had select on all columns. Replace
--     the table grant with a column list of what the portal actually reads.
--     Admin pages use the service-role client, which is unaffected.
--  2. billing_starts_at existed only in production; track it.
--  Idempotent; run once in the Supabase SQL editor.
-- ============================================================

alter table public.clients
  add column if not exists billing_starts_at timestamptz;   -- calls before this are tests, never billed

revoke select on public.clients from anon, authenticated;
grant select (
  id, name, slug, billing_mode, rate_per_minute_cents, monthly_price_cents,
  status, created_at, billing_starts_at, stripe_customer_id,
  channel, included_messages_per_month, chat_rate_per_message_cents, message_basis
) on public.clients to authenticated;

-- Never readable by client logins: retell_api_key, retell_agent_id,
-- cost_per_minute_cents, stripe_subscription_id, stripe_*_price_id,
-- notification_email, drive_folder_id, ingest_mode.
