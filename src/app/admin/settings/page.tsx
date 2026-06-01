import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'

export default async function SettingsPage() {
  const profile = await requireAdmin()

  const stripeMode = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test')
    ? 'Test mode'
    : 'Live mode'
  const fromEmail = process.env.RESEND_FROM_EMAIL || '—'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '—'

  const integrations = [
    { name: 'Supabase', detail: 'Database, auth & row-level security', status: 'Connected', ok: true },
    { name: 'Stripe', detail: `Billing · ${stripeMode}`, status: 'Connected', ok: true },
    { name: 'Retell AI', detail: 'Live call webhooks', status: 'Connected', ok: true },
    {
      name: 'Resend',
      detail: `Email · sending as ${fromEmail}`,
      status: fromEmail.includes('resend.dev') ? 'Test sender' : 'Connected',
      ok: !fromEmail.includes('resend.dev'),
    },
    { name: 'Vercel', detail: appUrl, status: 'Deployed', ok: true },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted">Configuration</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
      </div>

      {/* Account */}
      <section className="border border-ink/15 bg-card">
        <div className="border-b border-ink/15 px-6 py-3">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted">Account</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          <Field label="Signed in as" value={profile.email || '—'} />
          <Field label="Role" value={profile.role} />
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Password</p>
            <Link
              href="/forgot-password"
              className="mt-1 inline-block text-sm text-seal hover:underline"
            >
              Change password →
            </Link>
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section className="border border-ink/15 bg-card">
        <div className="border-b border-ink/15 px-6 py-3">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted">Integrations</h2>
        </div>
        {integrations.map((i) => (
          <div
            key={i.name}
            className="flex items-center justify-between border-b border-ink/10 px-6 py-4 last:border-0"
          >
            <div>
              <p className="text-ink">{i.name}</p>
              <p className="text-xs text-muted">{i.detail}</p>
            </div>
            <span className="flex items-center gap-2 text-sm text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${i.ok ? 'bg-emerald-500' : 'bg-seal'}`} />
              {i.status}
            </span>
          </div>
        ))}
      </section>

      <p className="text-xs text-muted">
        Default rates are set per client when you add them. To bill clients at your real
        domain, verify it in Resend and switch off the test sender.
      </p>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink">{value}</p>
    </div>
  )
}
