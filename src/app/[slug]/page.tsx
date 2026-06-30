import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getDefaultPaymentMethod } from '@/lib/stripe'
import { Logo } from '@/components/brand'
import { SignOut } from '@/components/sign-out'
import { PaymentMethodCard } from '@/components/payment-method'
import PortalCharts from '@/components/portal-charts'
import { SyncButton } from '@/components/sync-button'
import { CallLog, type CallRow } from '@/components/call-log'

export default async function ClientDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ card?: string }>
}) {
  const { slug } = await params
  const { card: cardParam } = await searchParams
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, name, slug, stripe_customer_id, billing_mode, rate_per_minute_cents, monthly_price_cents, created_at'
    )
    .eq('slug', slug)
    .maybeSingle()

  if (!client) redirect(profile.role === 'admin' ? '/admin' : '/')

  const card = client.stripe_customer_id
    ? await getDefaultPaymentMethod(client.stripe_customer_id).catch(() => null)
    : null

  const { data } = await supabase
    .from('calls')
    .select(
      'id, retell_call_id, call_type, started_at, duration_seconds, billed_cents, sentiment, disconnect_reason, recording_url, transcript, from_number'
    )
    .eq('client_id', client.id)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(500)

  const calls = (data ?? []) as CallRow[]

  return (
    <main className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-ink/15 px-7 py-4">
        <div className="flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <span className="font-serif text-lg font-semibold text-ink">{client.name}</span>
          {profile.role === 'admin' && (
            <span className="ml-2 border border-ink/15 px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted">
              admin view
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {profile.role === 'admin' && (
            <Link href="/admin" className="text-sm text-muted transition hover:text-ink">
              ← Admin
            </Link>
          )}
          <Link
            href={`/${slug}/settings`}
            className="text-sm text-muted transition hover:text-ink"
          >
            Settings
          </Link>
          <SignOut className="border border-ink/20 px-3.5 py-1.5 text-sm tracking-wide text-ink transition hover:bg-card" />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-8 p-7">
        <PaymentMethodCard
          slug={slug}
          card={card}
          justAdded={cardParam === 'added'}
          billingMode={client.billing_mode}
          rateCents={client.rate_per_minute_cents}
          monthlyCents={client.monthly_price_cents}
        />

        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted">Overview</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink">
            Dashboard
          </h1>
        </div>
        <PortalCharts calls={calls} />

        <div className="flex items-end justify-between pt-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted">Call history</p>
            <h2 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-ink">
              Your calls
            </h2>
          </div>
          <SyncButton slug={slug} />
        </div>
        <CallLog calls={calls} billingStartsAt={client.created_at} />
      </div>
    </main>
  )
}
