# VoiceDesk — Voice AI Client Dashboard

A clean, multi-tenant dashboard for **reselling Retell AI** to clients. Clients log in and see
their own calls, transcripts, recordings, usage, and invoices. You (the admin) manage client
"pods," set a per-minute rate (and optional monthly retainer), and Stripe bills them
automatically. You pay Retell ~15¢/min, charge the client more, and keep the margin.

Built in a calm Japanese-zen aesthetic. Pairs really well with **Claude Code** — see
[`CLAUDE.md`](./CLAUDE.md) for an architecture map and a setup walkthrough Claude can drive.

> ⚠️ This ships in **test/dev mode**. Read the **Going to production** section before charging
> real money or handling real call data.

## Stack
| Job | Tool |
|-----|------|
| App + hosting | Next.js 16 (App Router) on Vercel |
| Auth + database + RLS | Supabase (Postgres) |
| Billing (usage + subscriptions) | Stripe |
| Voice agents / call data | Retell AI |
| Transactional email | Resend |

## What's inside
- **Admin**: client-pod list, add/edit/delete pods, per-pod Retell API key + **multiple agents**,
  multiple client logins, billing/payment tracking, settings.
- **Client portal**: overview metrics + toggleable charts (calls/minutes/cost, with a time-range
  filter), searchable/sortable call history with inline recordings + transcripts, a "card on file"
  that auto-charges monthly, and account settings.
- **Webhooks**: `/api/webhooks/retell` ingests calls (per-pod key + multi-agent mapping);
  `/api/webhooks/stripe` mirrors invoices + saves the default card after checkout.
- **Auth emails**: branded Resend templates; password reset via a token-hash confirm route
  (`/auth/confirm`) that works from any browser.

## Quick start

### 1. Prerequisites
Node 18+ and free-tier accounts: **Supabase**, **Stripe**, **Retell AI**, **Resend**, **Vercel**.

### 2. Install
```bash
git clone <this-repo> && cd <repo>
npm install
cp .env.example .env.local   # then fill in your values (next steps)
```

### 3. Supabase
1. Create a project.
2. In the SQL editor, paste and run [`supabase/schema.sql`](./supabase/schema.sql). It creates the
   5 tables, row-level security, the security-definer helpers, and the role grants.
3. Project Settings → API: copy the **Project URL**, **anon key**, and **service_role key** into
   `.env.local`.
4. Create your **first admin**: in Authentication → Users, add a user (email + password). Then in
   the SQL editor run:
   ```sql
   insert into public.profiles (id, role, email)
   values ('<that-user-uuid>', 'admin', 'you@example.com');
   ```

### 4. Stripe (test mode)
1. Copy your **test secret key** → `STRIPE_SECRET_KEY`.
2. Create a **usage Meter** (Billing → Meters): event name `voicedesk_call_minutes`,
   aggregation **sum**, customer mapping **by id** on payload key `stripe_customer_id`, value on
   payload key `value`. Copy its id → `STRIPE_METER_ID` (and `STRIPE_METER_EVENT=voicedesk_call_minutes`).
3. After you deploy, add a **webhook endpoint** → `https://YOUR-APP/api/webhooks/stripe`
   (events: `checkout.session.completed`, `invoice.*`). Copy its signing secret → `STRIPE_WEBHOOK_SECRET`.

### 5. Retell + Resend
- **Retell**: copy an API key → `RETELL_API_KEY` (each pod can override with its own key in the UI).
- **Resend**: API key → `RESEND_API_KEY`; set `RESEND_FROM_EMAIL`. To email arbitrary addresses you
  must verify a sending domain in Resend (the shared test sender only reaches your own account email).
  Then point Supabase Auth → SMTP at Resend so auth emails are branded.

### 6. Run
```bash
npm run dev   # http://localhost:3000
```
Log in as your admin → **Add client** → paste a Retell key → **Load agents** → pick agent(s) →
add a client email (blank = email them an invite) → set the rate. Done.

### 7. Deploy (Vercel)
Set all the env vars in the Vercel project, deploy, then set `NEXT_PUBLIC_APP_URL` to the live URL
and point your Stripe + Retell webhooks at the deployed `/api/webhooks/*` routes.

## Going to production (read this)
- **Webhook signature is intentionally lenient** in this build: `src/app/api/webhooks/retell/route.ts`
  logs and records even on a signature mismatch so calls aren't dropped during testing.
  **Re-enable the 401** (it's a one-line change, marked with a comment) before going live.
- Add error monitoring (e.g. Sentry) and Terms/Privacy pages (you're storing call recordings/PII).
- Verify your Resend domain and switch off the test sender.

## Notes for Next.js 16
- Middleware is now **`proxy.ts`** (`src/proxy.ts`), and `cookies()` is **async**. The Supabase
  helpers in `src/lib/supabase/` already account for this.

## License
MIT — do whatever you want with it.
