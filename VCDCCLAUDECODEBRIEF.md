# VCDC Operations Hub

## Build Brief for Claude Code

**Client:** Vespa Club of Washington DC (VCDC), a 501(c)(3) nonprofit
**Owner:** Mark, perpetual admin and sole developer
**Status:** Board-sanctioned proof of concept, rebuilt from an earlier exploratory prototype
**Stack:** Next.js 15 on Vercel, Supabase (Postgres + Auth + Storage), Resend

---

## 0. Read this first

There is an earlier prototype on Replit at `replit.com/@mark1185/VCDC-Colors`. **We are not porting it.** It was exploration, and its architecture (pnpm monorepo, standalone Express server, Expo native app, Orval codegen, custom JWT auth) was the prototyping tool's choice rather than a considered decision. We are rebuilding smaller and simpler.

But it is not worthless. Section 2 lists exactly what to extract from it, and that extraction is the first thing you do. Some of it, particularly the offline bug fixes, represents real problems already discovered and solved. Rediscovering them would be a waste.

Work order:

1. Section 2: salvage from Replit. Ask Mark for whatever you cannot reach.
2. Confirm this brief back to Mark and flag anything ambiguous.
3. Propose a file tree for Slice 1 only. Wait for approval.
4. Build slice by slice, deploying at the end of each.

Do not scaffold future slices. Do not create placeholder files for work not yet started.

**Style rule, non-negotiable: no em dashes.** Not in UI copy, not in code comments, not in commit messages, not in your replies. Use commas, periods, colons, parentheses.

**Second style rule from the prototype, keep it: no emojis anywhere in product UI.** Strict TypeScript throughout.

---

## 1. What this system does

Replace VCDC's paper ride sign-in with a digital flow.

Three surfaces, one Next.js app, one deploy:

| Route group | Users | Auth |
|---|---|---|
| `/admin` | Mark, board officers later | Supabase magic link, role `admin` |
| `/ride` | ~10 authorized Ride Leaders | Supabase magic link, role `ride_leader` |
| `/waiver` | Guests | None, fully public |

**Members never log in.** Their identity is a QR code on a wallet pass in Apple Wallet or Google Wallet. That card doubles as proof of membership at participating local shops for a discount, so it must look like a real credential, not a debug artifact.

The loop:

1. Admin adds or renews a member. System emails Apple and Google Wallet pass links.
2. Ride Leader creates a ride, then downloads the member roster while still on signal.
3. At the start point, after the safety talk, the leader scans each rider. Fully offline.
4. Guests without a card sign at `/waiver` on their own phone and get a QR back. Scanned identically.
5. Leader ends the ride. When signal returns, the roster is submitted and emailed to the board as PDF and CSV.

**Scale:** ~100 members, 10 to 15 rides a year, ~10 Ride Leaders, 5 to 30 riders per ride. This is small. Do not build for scale that will never arrive. No caching layers, no queues beyond what Section 7 requires, no microservices, no monorepo.

### 1a. Domain and existing systems, read before Slice 1

**The club's domain is `vespaclubofdc.org`.** There is no `vcdc.org`. If you see that shorthand in any earlier document, it is wrong.

This matters for the guest flow. A Ride Leader texts the waiver link to a stranger in a parking lot, so `waiver.vespaclubofdc.org` is long to read aloud, type, or fit on a phone screen. Flag to Mark that a short dedicated domain is worth about twelve dollars, and use a placeholder env var (`NEXT_PUBLIC_WAIVER_URL`) until he decides. Do not hardcode a domain anywhere.

**DNS is managed at GoDaddy**, since the club site runs on GoDaddy Website Builder. Any subdomain is a GoDaddy task for Mark, not something you can do.

**There may already be a membership system.** The club site has Sign In and Create Account pages at `vespaclubofdc.org/m/account` and `/m/create-account`. Mark has said there is an existing membership system he does not have full visibility into, and this is very likely it.

**Consequence for member numbering:** if GoDaddy is already assigning member identities, generating a fresh sequence creates two competing identities per person, and reconciling that later is painful. Ask Mark to check what that system stores before you implement numbering. Prefer admin-assignable numbers with a suggested next value, so existing numbers can be entered as-is.

**Board contact:** `president@vespaclubofdc.org` is the likely default for `roster_recipient_emails`. Confirm with Mark.

**Legal name and status:** The Vespa Club of D.C., Inc., a 501(c)(3) private foundation, founded 2019. Use the exact legal name in any member-facing or waiver copy.

---

## 2. Salvage from the Replit prototype

Mark has the project open and can export a zip, or connect it to GitHub and push. There is currently **no GitHub remote**, only Replit's internal git, so ask him which he prefers. The repo has about 40 commits on `main` with a clean tree.

### Extract these

**`replit.md`** at the repo root. A genuinely good architecture document written by the prototype. Read it in full. It is the single most useful artifact in that project.

**Drizzle schema** at `lib/db/src/schema/`. Iterated against real use, including a considered switch to database sequences for member and guest numbering. Section 4 below is derived from it, but read the original for anything I missed.

**Wallet pass implementation** in `artifacts/api-server/src/routes/`. The pass field layout and certificate handling reportedly work, and this is the fiddliest code in the project. Env var names used there:

```
APPLE_WWDR_CERT, APPLE_SIGNER_CERT, APPLE_SIGNER_KEY,
APPLE_SIGNER_KEY_PASSPHRASE, APPLE_TEAM_IDENTIFIER,
APPLE_PASS_TYPE_IDENTIFIER, GOOGLE_WALLET_CREDENTIALS,
GOOGLE_WALLET_ISSUER_ID
```

**Brand tokens.** Do NOT use the hex values found in the prototype. They were approximations and are wrong. These were sampled directly from the club's actual badge and are authoritative:

| Token | Hex | Where it comes from |
|---|---|---|
| Amber | `#E48125` | Scooter body, the dominant brand color |
| Sky blue | `#89CBE5` | Enamel ring |
| Sunburst | `#FFF78D` | Rays behind the scooter |
| Cog gray | `#939599` | Outer gear ring |
| DC red | `#F14D4B` | DC flag on the scooter body |
| Italian green | `#2DA548` | Tricolore shield |
| Charcoal | `#2B2D2E` | Body text |

Green means active or success, red means error or unrecognized. If you find `#F4A436` or `#CE2B37` anywhere in the prototype, they are stale; replace them.

**Logo.** The badge is a circular emblem: gray cog outer ring, sky blue ring lettered "VESPA CLUB OF D.C." above and "ANNO MMXIX" below, an amber Vespa in profile carrying the DC flag, a sunburst behind it, and an Italian tricolore shield beneath. Ask Mark for transparent PNG at 1x, 2x, 3x plus SVG if it exists.

**Warning for Slice 2:** the cog ring's fine teeth and the outer text ring will turn to mush at the 29px height Apple Wallet uses for a pass logo. Plan on a simplified pass variant that keeps the scooter and sunburst and drops the cog and lettering. Raise this with Mark rather than shipping an illegible logo.

**Commit diffs for the offline fixes.** These commit messages name real bugs someone already hit:

- `fix: temp ride ID reconciliation + SMS URL + offline attendance integrity`
- `fix: mobile deep link, offline attendee removal, atomic attendance flush`
- `feat: offline attendance queue, flush-before-submit, consistent header branding`

Read those diffs before writing the offline layer in Slice 6. You will rewrite the code, but the failure modes are the same.

### Deliberately drop

Expo and React Native. The pnpm monorepo. Orval and the OpenAPI spec as contract. wouter. The standalone Express server. The custom cookie/Bearer JWT auth. The `passEvents` EventEmitter pattern, for reasons in Section 7.

### Database

**Do not migrate any data.** Mark confirmed the Replit production database holds test data only. Start clean.

---

## 3. Architecture

Decided. Do not relitigate these; raise a concern if you see a real problem, but do not silently substitute.

- **Framework:** Next.js 15, App Router, TypeScript, React Server Components where they earn it
- **Hosting:** Vercel, Hobby tier
- **Database:** Supabase Postgres, accessed through Drizzle ORM
- **Auth:** Supabase Auth, email magic link (OTP) only. No passwords, no OAuth
- **Storage:** Supabase Storage. Buckets: `waivers` (private), `brand` (public)
- **Email:** Resend
- **Styling:** Tailwind, shadcn/ui, lucide-react
- **PDF:** `pdf-lib` or `@react-pdf/renderer`, pick one, be consistent
- **QR generation:** `qrcode` server-side, `qrcode.react` client-side
- **QR scanning:** `@zxing/browser` or the BarcodeDetector API where available. Must work in mobile Safari over HTTPS
- **Wallet:** `passkit-generator` for Apple, `google-auth-library` plus Wallet REST for Google

### Route structure

Single app, route groups, shared components and types. No workspace packages.

```
app/
  (admin)/admin/...        role: admin
  (ride)/ride/...          role: ride_leader, PWA
  (public)/waiver/...      no auth
  api/...                  route handlers
lib/
  db/                      drizzle schema + client
  qr/                      payload build + verify
  wallet/                  apple + google pass generation
  email/                   resend wrappers
  pdf/                     roster PDF + CSV
components/                shared UI
```

### Row Level Security

Enable RLS on every table. The Supabase anon key ships to the browser, so this is not optional even at 100 members.

- Store role in `auth.users.raw_app_meta_data` so it lands in the JWT. Read via `auth.jwt() -> 'app_metadata' -> 'role'`. **Never** put role in `user_metadata`; users can edit that themselves.
- `members`, `rides`, `ride_attendance`, `ride_leaders`, `app_settings`, `waiver_versions`: full access for `admin`. A `ride_leader` may read the active member roster and read/write only rides where they are the assigned leader.
- `guest_waivers`: insertable by `anon`, because the public waiver form needs that. Readable only by `admin` and authenticated `ride_leader`. **Never publicly readable.** It holds emergency contacts and signature images.
- Write policies as SQL migrations in `supabase/migrations/`, not clicked into the dashboard.

---

## 4. Schema

```sql
-- Members. Signatures live in the club's renewal records, not here.
create table members (
  id uuid primary key default gen_random_uuid(),
  member_number integer unique not null,
  first_name text not null,
  last_name text not null,
  email text unique not null,
  phone text,
  membership_tier text not null default 'regular'
    check (membership_tier in ('regular','lifetime','honorary')),
  joined_at date not null,
  expires_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ride leaders. Not all are members, so member_id is nullable.
-- user_id populates on first successful login.
create table ride_leaders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text unique not null,
  full_name text not null,
  member_id uuid references members(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Versioned waiver text so admin edits do not invalidate signed history.
create table waiver_versions (
  version integer primary key generated always as identity,
  body_markdown text not null,
  effective_from timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Guest waivers. Declared before attendance, which references it.
create table guest_waivers (
  id uuid primary key default gen_random_uuid(),
  guest_number integer generated always as identity,   -- displayed G00001
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  signature_path text not null,        -- Supabase Storage path, NOT base64 in-row
  waiver_text_version integer not null references waiver_versions(version),
  signed_at timestamptz not null default now(),
  signed_ip inet,
  user_agent text,
  qr_token text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table rides (
  id uuid primary key default gen_random_uuid(),
  ride_leader_id uuid not null references ride_leaders(id),
  ride_date date not null,
  route_name text not null,
  start_location text,
  notes text,
  status text not null default 'planned'
    check (status in ('planned','active','submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Exactly one of member_id or guest_waiver_id is set.
create table ride_attendance (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id) on delete cascade,
  member_id uuid references members(id),
  guest_waiver_id uuid references guest_waivers(id),
  scanned_at timestamptz not null,
  scanned_offline boolean not null default false,
  constraint one_identity check (
    (member_id is not null and guest_waiver_id is null) or
    (member_id is null and guest_waiver_id is not null)
  ),
  unique (ride_id, member_id),
  unique (ride_id, guest_waiver_id)
);

create table app_settings (
  id boolean primary key default true check (id),
  roster_recipient_emails text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index on members (member_number);
create index on members (expires_at);
create index on ride_attendance (ride_id);
create index on guest_waivers (qr_token);
create index on rides (ride_leader_id, ride_date desc);
```

### Notes

**Do not store `active` as a column.** The prototype learned this: compute `expires_at >= current_date` in queries or as a generated column, never as a boolean someone has to remember to update.

**Member numbers.** The prototype used database sequences. But VCDC has an existing membership system Mark does not have full visibility into, and members may already have numbers. **Ask Mark before implementing:** sequence starting at 10001, or admin-assignable with a suggested next value. Admin-assignable is probably safer.

---

## 5. QR payloads

```
Member:  vcdc:m:{member_number}:{sig}
Guest:   vcdc:g:{guest_number}:{qr_token}
```

`sig` is HMAC-SHA256 of `vcdc:m:{member_number}` keyed with `QR_SIGNING_SECRET`, truncated to 16 hex characters.

**Verification is offline**, so the scanner cannot call the server. Use this approach: the synced roster payload includes each member's **precomputed signature**, and the scanner compares rather than computes. No secret ever reaches the device. At 100 members the payload is trivially small. (The alternative, shipping the signing secret to each leader's phone, is worse for no benefit.)

Guest QRs need a network call to validate the token against the database, or the leader can accept them optimistically offline and let the server reject on submit. Ask Mark which he prefers; optimistic acceptance is friendlier in a parking lot.

**Never encode a URL in the QR.** The `vcdc:` scheme keeps these inert to random camera, banking, and airline apps. This was a deliberate choice, preserve it.

---

## 6. Wallet passes

Highest-risk area. Test on real devices early, in Slices 2 and 3, not at the end.

### Apple

- Style: **Generic**. Not Coupon, not EventTicket. Generic reads most like a membership card, which matters at a shop counter.
- Fields: header `VCDC MEMBER`; primary member full name; secondary left `MEMBER #`; secondary right `TIER`; auxiliary `EXPIRES`.
- Barcode: `PKBarcodeFormatQR`, `messageEncoding: "iso-8859-1"`, message is the member payload.
- Colors: background sky blue `#7EC8E3`, foreground charcoal or white, whichever passes contrast against that blue. Check it, do not assume.
- Set `expirationDate` to the membership expiry. Apple Wallet then retires the pass on its own, which is why we need no pass update service.
- `backFields`: present but empty. Phase 2 fills it.
- No `webServiceURL`, no `authenticationToken`. Passes are static by design.

### Vercel certificate gotcha, read carefully

`passkit-generator` normally reads certs from disk. **Vercel has no writable persistent filesystem.** Store certs as base64 environment variables, decode to Buffers at runtime, pass Buffers to the library. Generate the pass in memory and stream it with `Content-Type: application/vnd.apple.pkpass`. Never write a `.pkpass` to disk first.

### Google

- `genericClass` and `genericObject`, same fields and payload as Apple.
- Service account JSON as a base64 env var.
- Class created once, idempotently, via a one-off script or first-deploy check.
- Distribution is a signed JWT in a Save to Google Wallet link.

### Distribution

On member create or renew, email both options. Apple via `GET /api/wallet/apple/[memberId]` returning the stream; Google via the JWT save link. **Guard the Apple endpoint with a signed expiring token in the URL** so passes are not enumerable by walking member IDs. Use Apple's and Google's official badge artwork and respect their sizing guidelines.

---

## 7. Serverless traps

The prototype ran as a long-lived Express process. Two things it did will silently break on Vercel.

**In-process EventEmitter does not survive serverless.** The prototype fires wallet pass generation on member create/renew through a `passEvents` emitter. On Vercel the function returns its response, the container freezes, and the listener never runs. The member silently never receives their pass, with no error anywhere. **Do the pass generation and email synchronously inside the request**, or use `after()` from `next/server`, or a Vercel Cron route. Never an in-process emitter.

**PDF generation is the heaviest operation here.** It runs on ride submission. Keep it inside the request and watch the function duration limit; if a 30-rider roster PDF approaches the ceiling, move it to a Cron route that emails asynchronously and tell Mark.

---

## 8. Offline behavior

Pattern: **online to prepare, offline to execute, online to submit.** Not bidirectional sync. This is all the club needs and far simpler.

**Prepare.** Leader opens `/ride` at home or the gas station. Fetch the active roster: member number, first name, last name, tier, precomputed signature. Nothing more, no emails, no phone numbers. Store in IndexedDB with a timestamp. Show "Roster synced 4 minutes ago" prominently. Warn loudly past 7 days.

**Execute.** Scan mode runs entirely against IndexedDB. Zero network calls on this path. Develop with the network tab throttled to offline and confirm it still works.

Scan feedback:
- Member recognized: name and number, success chime, green flash
- Guest QR: name and `G#####`, distinct chime
- Duplicate: haptic buzz plus "Already on the list", no duplicate row
- Unrecognized: "Not recognized. Have them sign at [waiver URL]" plus a button opening the native SMS composer via an `sms:` URL. Do not build a texting integration.

**Submit.** On End Ride, POST the attendance array, mark submitted, generate PDF and CSV, email the board. If offline, queue and show a persistent "1 ride waiting to submit" banner. Retry on the `online` event and on next app open.

**PWA requirements.** Service worker precaching the shell, JS, CSS, chimes, and logo. Proper manifest and icons. Installable to home screen. Test on real iOS Safari, the fussiest target.

**iOS Safari specifics you will hit:**
- Audio needs a user gesture to unlock. Prime the chimes on the first tap of a session.
- `navigator.vibrate` is unsupported. Duplicate-scan feedback must have a visual fallback.
- Camera requires HTTPS. Fine on Vercel, a nuisance on local dev; use a tunnel.

**Critical data-safety rule.** A leader offline for hours has an expired access token. **Never let an auth failure destroy local attendance.** Persist scans to IndexedDB first, authenticate second. Losing 22 scanned riders to a login redirect is the worst possible failure in this system.

---

## 9. Email, via Resend

Three transactional messages:

1. **Member welcome or renewal.** Apple and Google Wallet buttons.
2. **Guest waiver signed.** Their QR as inline image plus PNG attachment, so they can pull it from their inbox if the browser tab is gone.
3. **Ride submitted.** Roster PDF and CSV to the addresses in `app_settings.roster_recipient_emails`.

Degrade gracefully to a no-op when `RESEND_API_KEY` is absent, so local development does not require it. The prototype did this and it was the right call.

---

## 10. Environment variables

Document every one in `.env.example` with a comment. Mark sets values in the Vercel dashboard.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only, never expose
DATABASE_URL=                     # pooled connection for Drizzle

# App
NEXT_PUBLIC_APP_URL=
QR_SIGNING_SECRET=                # 32+ random bytes hex
ADMIN_EMAIL=                      # bootstrap admin

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=                # domain must be verified

# Apple Wallet, all base64
APPLE_WWDR_CERT_B64=
APPLE_PASS_CERT_P12_B64=
APPLE_PASS_CERT_PASSWORD=
APPLE_PASS_TYPE_ID=
APPLE_TEAM_ID=

# Google Wallet
GOOGLE_WALLET_SERVICE_ACCOUNT_B64=
GOOGLE_WALLET_ISSUER_ID=
GOOGLE_WALLET_CLASS_ID=
```

Add a startup validation module that fails fast naming any missing variable. Debugging a wallet failure that turns out to be a typo'd env var name is a miserable afternoon.

**Never ask Mark to paste a private key, certificate password, or API key into chat.** Name the variable; he sets it in Vercel.

---

## 11. Build order

Nine slices. Each deploys to Vercel and is demoable before the next starts.

| # | Slice | Done when |
|---|---|---|
| 1 | Supabase project, schema, RLS, admin auth, member CRUD | Mark logs in, adds 5 members, sees the list |
| 2 | Apple Wallet pass | A real pass lands in Mark's iPhone Wallet and looks right |
| 3 | Google Wallet pass | Same on Android |
| 4 | Ride Leader auth, ride CRUD | A test leader logs in and creates a ride |
| 5 | Scan mode, online only | Scanning a real wallet pass adds the member to a roster |
| 6 | Offline mode and PWA | Airplane mode, full ride scanned, submits on reconnect |
| 7 | Submit, PDF, CSV, email | Board email arrives with correct attachments |
| 8 | Public waiver page | Guest signs on their phone, gets a QR, leader scans it |
| 9 | Polish | Empty, error, and loading states; brand styling; mobile pass |

Slices 2, 3, 5, 6, and 8 cannot be validated in a desktop browser. Say clearly when you need Mark to test on a phone.

---

## 12. Out of scope

Do not build these. Argue for one if you think it is essential, but do not build it unasked.

Back-of-pass fields. Member self-service portal. Wallet pass push updates. Expiry reminder emails. Multiple leaders scanning one ride. GPS or device fingerprinting on waivers. Integration with the club's existing membership system. Dues payment processing. Native mobile apps. Rally check-in. Member ride history.

Several of these are on the board's wish list for later. The schema should not actively prevent them, but nothing ships for them now.

---

## 13. Deliverables

- Working app deployed to Vercel
- `supabase/migrations/` with schema and RLS policies, in version control
- `.env.example` fully documented
- `README.md`: local setup, migrations, deploy, rotating `QR_SIGNING_SECRET`
- `WALLET-SETUP.md`: exact click-path for Apple certificate generation and Google issuer setup, written for a future maintainer who is not Mark. **Include that Apple pass certificates expire annually.** This will bite in mid-2027 otherwise.
- Seed script: 1 admin, 3 ride leaders, 12 members across all tiers with varied expiry dates including one expired, 2 historical rides with attendance

---

## 14. Still owed by Mark

Ask at the slice that needs it. Do not block early slices waiting.

1. VCDC logo, PNG and SVG (Slice 2)
2. Apple Team ID and Pass Type Identifier (Slice 2)
3. Apple `.p12` certificate and password (Slice 2)
4. Google Wallet issuer ID and service account JSON (Slice 3)
5. Resend API key and verified sending domain (Slice 7)
6. Current paper waiver text, to seed `waiver_versions` (Slice 8)
7. Which board emails receive rosters (Slice 7)
8. DNS for the waiver and app subdomains (Slice 8). See the domain note in Section 1a.
9. Member number assignment decision: sequence or manual (Slice 1)
10. Guest QR offline handling: optimistic or require network (Slice 6)

---

## 15. Working agreement

- Ask clarifying questions before writing code when something is ambiguous. Ambiguity is Mark's fault, not yours, and he would rather answer than review a wrong build.
- Show a plan or file tree before generating files for a slice.
- Small commits labeled by slice: `Slice 2: Apple Wallet pass generation`.
- Never request secrets in chat. Name the env var.
- Flag genuinely hard architectural calls instead of guessing. Mark has Claude available for a second opinion.
- No em dashes. No emojis in product UI. Strict TypeScript.

Confirm you have read this, flag anything ambiguous, then propose the Slice 1 file tree.
