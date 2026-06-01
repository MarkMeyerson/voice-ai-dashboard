# VoiceDesk — guide for Claude Code

This is a Next.js 16 multi-tenant dashboard for reselling Retell AI voice agents to clients.
If you're helping someone set this up or extend it, start here. User-facing setup is in `README.md`.

## ⚠️ This is Next.js 16 — not what you may remember
- **Middleware is `proxy.ts`** (see `src/proxy.ts`), not `middleware.ts`.
- **`cookies()` is async** — always `await cookies()`.
- Dynamic route `params` and `searchParams` are **Promises** — `await` them.
- When unsure about an API, read the local docs in `node_modules/next/dist/docs/`.

## Architecture map
```
src/
  proxy.ts                         # session refresh + route gating (Next 16 middleware)
  lib/
    supabase/{client,server,admin,proxy}.ts   # browser / RSC / service-role / proxy clients
    auth.ts                        # getProfile() DAL + requireAdmin()
    stripe.ts                      # customers, metered+monthly prices, subs, usage, billing reads
    retell.ts                      # signature verify, callToRow mapper, agent webhook + list helpers
    email.ts                       # Resend client + branded transactional templates
  app/
    login/ forgot-password/ reset-password/   # auth screens
    auth/confirm/route.ts          # token-hash verifyOtp (email links work from any browser)
    admin/                         # admin: pods list, new, [slug]/edit, billing, settings
    admin/pod-actions.ts           # create / update / delete pod, fetchAgents (server actions)
    [slug]/                        # client portal (dashboard + settings) + actions.ts (payment, sync)
    api/webhooks/{retell,stripe}/route.ts
  components/                      # brand, call-log, portal-charts, payment-method, pod-form, etc.
supabase/schema.sql                # run this in Supabase SQL editor (tables + RLS + grants)
```

## Data model (Postgres, in `supabase/schema.sql`)
- `clients` — the pods (rate/cost in **integer cents**, billing_mode, retell_api_key, stripe ids, status)
- `profiles` — users; `role` admin|client, `client_id` links a client login to a pod
- `pod_agents` — a pod can own **many** Retell agents (maps agent_id → pod)
- `calls` — one row per call; unique `retell_call_id` (idempotent); `cost_cents` vs `billed_cents`
- `invoices`, `usage_events` — Stripe mirrors / usage-report log

RLS isolates tenants: clients can only `select` their own rows via `current_client_id()`; admins
see all via `is_admin()`. Webhooks/admin use the **service-role** client which bypasses RLS.

## Setup checklist (what to do for a new user)
1. `npm install`, `cp .env.example .env.local`.
2. Create a Supabase project; run `supabase/schema.sql`; fill the 3 Supabase vars.
3. Create the first admin: add a Supabase auth user, then
   `insert into public.profiles (id, role, email) values ('<uuid>','admin','you@x.com');`
4. Stripe (test): secret key; create a usage Meter (`event_name=voicedesk_call_minutes`,
   sum, customer by id on `stripe_customer_id`, value on `value`) → `STRIPE_METER_ID`;
   after deploy add a webhook → `STRIPE_WEBHOOK_SECRET`.
5. Retell + Resend keys. `npm run dev`.

## Conventions
- **Money is integer cents** everywhere in the DB. Convert at the edges.
- **Per-pod Retell key**: the webhook verifies/fetches with `clients.retell_api_key`, falling back
  to `RETELL_API_KEY`. Agents are attributed to pods via `pod_agents` (fallback: `clients.retell_agent_id`).
- **Adding a pod** sets each chosen agent's `webhook_url` to `${NEXT_PUBLIC_APP_URL}/api/webhooks/retell`.
- **Billing**: a card added in the client portal (Stripe Checkout setup mode) becomes the default PM
  via the `checkout.session.completed` webhook; the subscription then auto-charges monthly.

## Before production
`src/app/api/webhooks/retell/route.ts` currently records calls **even if the Retell signature
fails** (logged), so nothing is dropped while testing. Re-enable the `401` (marked with a comment).
Also add error monitoring + legal pages, and verify a Resend sending domain.
