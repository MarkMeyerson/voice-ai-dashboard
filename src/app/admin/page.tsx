import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

type Pod = {
  id: string
  name: string
  slug: string
  billing_mode: string
  rate_per_minute_cents: number
  cost_per_minute_cents: number
  monthly_price_cents: number
  status: string
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export default async function AdminPage() {
  await requireAdmin()
  const supabase = await createClient()
  const { data } = await supabase
    .from('clients')
    .select(
      'id, name, slug, billing_mode, rate_per_minute_cents, cost_per_minute_cents, monthly_price_cents, status'
    )
    .order('created_at', { ascending: false })

  const pods = (data ?? []) as Pod[]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Heading */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted">
            Overview
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink">
            Client pods
          </h1>
        </div>
        <Link
          href="/admin/new"
          className="group relative bg-ink px-4 py-2.5 text-sm tracking-wide text-card transition hover:bg-ink/90"
        >
          Add client
          <span className="absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-seal" />
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 divide-y divide-ink/12 border border-ink/15 bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Active pods" value={String(pods.length)} />
        <Stat label="Billed this month" value="$0.00" sub="all clients" />
        <Stat label="Your margin" value="$0.00" sub="this month" accent />
      </div>

      {/* Pods */}
      <div className="border border-ink/15 bg-card">
        <div className="grid grid-cols-[1.5fr_1fr_1fr_0.8fr] gap-4 border-b border-ink/15 px-6 py-3 text-[11px] uppercase tracking-[0.18em] text-muted">
          <span>Client</span>
          <span>Rate</span>
          <span>Billing</span>
          <span>Status</span>
        </div>

        {pods.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-ink/20">
              <span className="h-2 w-2 rounded-full bg-seal" />
            </div>
            <div className="space-y-1">
              <p className="font-serif text-lg text-ink">A quiet start</p>
              <p className="text-sm text-muted">
                No client pods yet. Add your first to begin tracking calls.
              </p>
            </div>
          </div>
        ) : (
          pods.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-[1.5fr_1fr_1fr_0.8fr] items-center gap-4 border-b border-ink/10 px-6 py-4 text-sm transition last:border-0 hover:bg-ink/[0.02]"
            >
              <div>
                <Link href={`/${p.slug}`} className="text-ink hover:text-seal">
                  {p.name}
                </Link>
                <p className="text-xs text-muted">/{p.slug}</p>
              </div>
              <span className="text-ink">
                {p.billing_mode === 'per_minute'
                  ? `${money(p.rate_per_minute_cents)}/min`
                  : `${money(p.monthly_price_cents)}/mo`}
              </span>
              <span className="text-muted">
                {p.billing_mode === 'per_minute'
                  ? 'Per minute'
                  : 'Monthly + usage'}
              </span>
              <span className="flex items-center justify-between gap-2 text-muted">
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-seal" />
                  {p.status}
                </span>
                <Link
                  href={`/admin/${p.slug}/edit`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit
                </Link>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="p-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
        {label}
      </p>
      <p
        className={`mt-2 font-serif text-3xl font-semibold tracking-tight ${
          accent ? 'text-seal' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  )
}
