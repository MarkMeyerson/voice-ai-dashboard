import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getClientBilling } from '@/lib/stripe'

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

const statusStyle: Record<string, string> = {
  paid: 'text-emerald-600',
  open: 'text-amber-600',
  draft: 'text-muted',
  void: 'text-muted line-through',
  uncollectible: 'text-seal',
}

export default async function BillingPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data: clientsData } = await supabase
    .from('clients')
    .select('id, name, slug, stripe_customer_id, rate_per_minute_cents')
    .order('created_at')
  const clients = clientsData ?? []

  // Accruing usage this month (per client), from our own call records.
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const { data: callsData } = await supabase
    .from('calls')
    .select('client_id, billed_cents, started_at')
    .gte('started_at', monthStart.toISOString())
  const accruing: Record<string, number> = {}
  for (const c of callsData ?? []) {
    accruing[c.client_id] = (accruing[c.client_id] ?? 0) + Number(c.billed_cents)
  }

  // Stripe billing per client (parallel).
  const billing = await Promise.all(
    clients.map(async (c) => {
      if (!c.stripe_customer_id)
        return { id: c.id, subStatus: 'none', invoices: [] as Awaited<ReturnType<typeof getClientBilling>>['invoices'] }
      try {
        const b = await getClientBilling(c.stripe_customer_id)
        return { id: c.id, ...b }
      } catch {
        return { id: c.id, subStatus: 'error', invoices: [] }
      }
    })
  )
  type Billing = {
    subStatus: string
    invoices: Awaited<ReturnType<typeof getClientBilling>>['invoices']
  }
  const billingById: Record<string, Billing> = Object.fromEntries(
    billing.map((b) => [b.id, { subStatus: b.subStatus, invoices: b.invoices }])
  )

  const allInvoices = billing.flatMap((b) => b.invoices)
  const totalPaid = allInvoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total, 0)
  const totalOpen = allInvoices.filter((i) => i.status === 'open').reduce((s, i) => s + i.total, 0)
  const totalAccruing = Object.values(accruing).reduce((s, v) => s + v, 0)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted">Payments</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink">
          Billing
        </h1>
      </div>

      <div className="grid grid-cols-1 divide-y divide-ink/12 border border-ink/15 bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Collected (paid)" value={money(totalPaid)} accent />
        <Stat label="Outstanding (sent)" value={money(totalOpen)} />
        <Stat label="Accruing this month" value={money(totalAccruing)} />
      </div>

      {clients.map((c) => {
        const b = billingById[c.id]
        const invs = (b?.invoices ?? []).filter((i) => i.total !== 0)
        return (
          <div key={c.id} className="border border-ink/15 bg-card">
            <div className="flex items-center justify-between border-b border-ink/15 px-6 py-4">
              <div>
                <p className="font-serif text-lg text-ink">{c.name}</p>
                <p className="text-xs text-muted">
                  Subscription: <span className="text-ink">{b?.subStatus}</span> · accruing{' '}
                  <span className="text-ink">{money(accruing[c.id] ?? 0)}</span> this month
                </p>
              </div>
            </div>

            {invs.length > 0 ? (
              <>
                <div className="grid grid-cols-[1fr_1fr_1fr_0.8fr_0.6fr] gap-4 border-b border-ink/15 px-6 py-2.5 text-[11px] uppercase tracking-[0.18em] text-muted">
                  <span>Invoice</span>
                  <span>Date</span>
                  <span>Amount</span>
                  <span>Status</span>
                  <span>Sent</span>
                </div>
                {invs.map((i) => (
                  <div
                    key={i.id}
                    className="grid grid-cols-[1fr_1fr_1fr_0.8fr_0.6fr] items-center gap-4 border-b border-ink/10 px-6 py-3 text-sm last:border-0"
                  >
                    <span className="text-ink">
                      {i.url ? (
                        <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-seal hover:underline">
                          {i.number || i.id.slice(0, 12)}
                        </a>
                      ) : (
                        i.number || i.id.slice(0, 12)
                      )}
                    </span>
                    <span className="text-muted">
                      {new Date(i.created * 1000).toLocaleDateString()}
                    </span>
                    <span className="text-ink">{money(i.total)}</span>
                    <span className={statusStyle[i.status] ?? 'text-muted'}>{i.status}</span>
                    <span className="text-muted">{i.status === 'draft' ? '—' : 'yes'}</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-muted">
                No invoices yet — usage is accruing and will be invoiced at the period end.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{label}</p>
      <p className={`mt-2 font-serif text-3xl font-semibold tracking-tight ${accent ? 'text-seal' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  )
}
