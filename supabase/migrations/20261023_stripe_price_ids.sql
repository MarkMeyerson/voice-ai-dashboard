-- ============================================================
--  Stripe prices per pod, so a subscription can be created later
--  (when the client adds a payment method) rather than at pod creation.
--  Idempotent; run once in the Supabase SQL editor.
-- ============================================================

alter table public.clients
  add column if not exists stripe_monthly_price_id text,   -- flat retainer price
  add column if not exists stripe_usage_price_id   text;   -- metered price (minutes, or tiered messages)
