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
    stripe.ts                      # customers, metered+monthly+tiered prices, subs, meter events, billing reads
    retell.ts                      # signature verify, callToRow/chatToRow mappers, list + get + syncAgentChats
    metering.ts                    # Stripe usage reporting (DB-first, idempotent): calls once, chats as deltas
    usage.ts                       # month bounds (Chicago), metered-message rule, usage card math
    drive.ts                       # transcript files in Supabase Storage (name is historical), signed URLs
    email.ts                       # Resend client + branded transactional templates
  app/
    login/ forgot-password/ reset-password/   # auth screens
    auth/confirm/route.ts          # token-hash verifyOtp (email links work from any browser)
    admin/                         # admin: pods list, new, [slug]/edit, billing, settings
    admin/pod-actions.ts           # create / update / delete pod, fetchAgents (server actions)
    [slug]/                        # client portal (dashboard + settings) + actions.ts (payment, sync)
    api/webhooks/{retell,stripe}/route.ts
    api/cron/reconcile/route.ts    # every 15 min (vercel.json): heals missed webhooks, polls poll-mode pods
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

`schema.sql` is the full schema for a fresh database (section 7 lists columns added after the
original freeze). Changes to an existing database go in `supabase/migrations/*.sql`
(idempotent, run by hand in the SQL editor); add the same columns to schema.sql section 7.

### Chat plans (first client: WFWC, `supabase/migrations/20261022_chat_plans.sql`)
- `clients.channel` 'voice' | 'chat' picks the client-facing words (calls/minutes vs
  conversations/messages). `included_messages_per_month` + `chat_rate_per_message_cents`
  (overage rate) + `monthly_price_cents` describe the plan; `message_basis` 'agent' | 'all'
  says what counts as one message (`src/lib/usage.ts` does the month math, America/Chicago).
- `clients.ingest_mode` 'poll' means the agent's webhook belongs to another service, so the
  reconcile cron pulls chats (`syncAgentChats` in `retell.ts`: v3/list-chats + get-chat, because
  list-chats returns no transcript or messages) and never alerts or emails for that pod.
  `pod_agents.channel` tells the cron which agents are chat agents.
- Ongoing chats are re-upserted so counts grow; greeting-only chats (no user turn) meter as 0.
- Never show the word "Retell" in a client view.

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

## Production notes
- The Retell webhook returns `401` on a bad signature (verified with the pod key, then the global key).
- `/api/cron/reconcile` refuses to run unless `CRON_SECRET` is set (Vercel sends it automatically).
- The `call-transcripts` Storage bucket must be **private**; emails carry 7-day signed links.
- Client logins are granted only the `clients` columns the portal shows (see
  `supabase/migrations/20261023_client_column_grants.sql`); admin pages use the service-role client.
- Still to do: error monitoring, legal pages, a verified Resend sending domain.
- Review findings and status: `docs/review-2026-10-23.md`.
