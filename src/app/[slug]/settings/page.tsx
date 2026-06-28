import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getDefaultPaymentMethod } from '@/lib/stripe'
import { Logo } from '@/components/brand'
import { SignOut } from '@/components/sign-out'
import { PaymentMethodCard } from '@/components/payment-method'

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export default async function ClientSettings({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, name, slug, stripe_customer_id, billing_mode, rate_per_minute_cents, monthly_price_cents'
    )
    .eq('slug', slug)
    .maybeSingle()

  if (!client) redirect(profile.role === 'admin' ? '/admin' : '/')

  const card = client.stripe_customer_id
    ? await getDefaultPaymentMethod(client.stripe_customer_id).catch(() => null)
    : null

  return (
    <main className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-ink/15 px-7 py-4">
        <div className="flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <span className="font-serif text-lg font-semibold text-ink">{client.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href={`/${slug}`} className="text-sm text-muted transition hover:text-ink">
            ← Dashboard
          </Link>
          <SignOut className="border border-ink/20 px-3.5 py-1.5 text-sm tracking-wide text-ink transition hover:bg-card" />
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 p-7">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted">Account</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink">
            Settings
          </h1>
        </div>

        {/* Account */}
        <section className="border border-ink/15 bg-card">
          <div className="border-b border-ink/15 px-6 py-3">
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted">Your account</h2>
          </div>
          <div className="space-y-4 px-6 py-5">
            <Field label="Business" value={client.name} />
            <Field label="Email" value={profile.email || '—'} />
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Password</p>
              <Link
                href="/forgot-password"
                className="mt-1 inline-block text-sm text-seal hover:underline"
              >
                Reset password →
              </Link>
            </div>
          </div>
        </section>

        {/* Plan + payment */}
        <section className="space-y-4">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted">Billing &amp; payment</h2>
          <PaymentMethodCard
            slug={slug}
            card={card}
            billingMode={client.billing_mode}
            rateCents={client.rate_per_minute_cents}
            monthlyCents={client.monthly_price_cents}
          />
          <p className="text-xs text-muted">
            You&apos;re billed {money(client.rate_per_minute_cents)} per minute
            {client.billing_mode === 'monthly_plus_usage' && client.monthly_price_cents > 0
              ? ` plus a ${money(client.monthly_price_cents)} monthly retainer`
              : ''}
            . With a card on file, your invoice is charged automatically each month.
          </p>
        </section>

        {/* Support */}
        <section className="border border-ink/15 bg-card px-6 py-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Need help?</p>
          <p className="mt-1 text-sm text-ink">
            Email{' '}
            <a
              href="mailto:info@sherpatech.ai"
              className="text-seal hover:underline"
            >
              info@sherpatech.ai
            </a>{' '}
            and we&apos;ll get back to you.
          </p>
        </section>
      </div>
    </main>
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
