import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PodForm } from '@/components/pod-form'
import { DeletePodButton } from '@/components/delete-pod-button'
import { AttachStripeButton } from '@/components/attach-stripe-button'

function dollars(cents: number) {
  return (cents / 100).toFixed(2)
}

export default async function EditPodPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await requireAdmin()
  const { slug } = await params
  // Admin-only page: needs retell_api_key and Stripe ids, which client
  // logins are not granted; the service-role client bypasses that.
  const supabase = createAdminClient()

  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, name, slug, billing_mode, status, rate_per_minute_cents, cost_per_minute_cents, monthly_price_cents, retell_api_key, retell_agent_id, notification_email, channel, included_messages_per_month, chat_rate_per_message_cents, message_basis, ingest_mode, stripe_customer_id, stripe_subscription_id, stripe_monthly_price_id, stripe_usage_price_id, billing_starts_at'
    )
    .eq('slug', slug)
    .maybeSingle()

  if (!client) redirect('/admin')

  const { data: agentRows } = await supabase
    .from('pod_agents')
    .select('retell_agent_id, agent_name, channel')
    .eq('client_id', client.id)
  const { data: users } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('client_id', client.id)

  // Merge the pod's agents from pod_agents + the legacy single-agent field.
  const agentMap = new Map<string, { id: string; name: string; channel?: 'voice' | 'chat' }>()
  for (const a of agentRows ?? []) {
    agentMap.set(a.retell_agent_id, {
      id: a.retell_agent_id,
      name: a.agent_name ?? 'Agent',
      channel: a.channel === 'chat' ? 'chat' : 'voice',
    })
  }
  if (client.retell_agent_id && !agentMap.has(client.retell_agent_id)) {
    agentMap.set(client.retell_agent_id, { id: client.retell_agent_id, name: 'Agent' })
  }
  const agents = Array.from(agentMap.values())

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/admin" className="text-sm text-muted transition hover:text-ink">
        ← Client pods
      </Link>
      <div className="mt-3 mb-8">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted">Edit</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink">
          {client.name}
        </h1>
      </div>
      <PodForm
        mode="edit"
        initial={{
          id: client.id,
          name: client.name,
          slug: client.slug,
          billingMode: client.billing_mode,
          status: client.status,
          rateDollars: dollars(client.rate_per_minute_cents),
          costDollars: dollars(client.cost_per_minute_cents),
          monthlyDollars: dollars(client.monthly_price_cents),
          retellApiKey: client.retell_api_key ?? '',
          notificationEmail: client.notification_email ?? '',
          agents,
          users: (users ?? []).map((u) => ({ id: u.id, email: u.email ?? '' })),
          channel: client.channel === 'chat' ? 'chat' : 'voice',
          includedMessages: String(client.included_messages_per_month ?? 0),
          rateMessageDollars: client.chat_rate_per_message_cents
            ? dollars(client.chat_rate_per_message_cents)
            : '',
          messageBasis: client.message_basis === 'all' ? 'all' : 'agent',
          ingestMode: client.ingest_mode === 'poll' ? 'poll' : 'webhook',
        }}
      />

      {/* Stripe */}
      <div className="mt-10 border border-ink/15 bg-card p-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Stripe</p>
        {client.stripe_customer_id ? (
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-ink">
              Customer <span className="font-mono text-xs">{client.stripe_customer_id}</span>
            </p>
            <p className="text-muted">
              Subscription:{' '}
              {client.stripe_subscription_id ? (
                <span className="font-mono text-xs text-ink">{client.stripe_subscription_id}</span>
              ) : (
                'starts when the client adds a payment method'
              )}
              {client.billing_starts_at
                ? ` · billing from ${new Date(client.billing_starts_at).toLocaleDateString()}`
                : ''}
            </p>
            <p className="text-xs text-muted">
              Prices: {client.stripe_monthly_price_id ?? '—'} · {client.stripe_usage_price_id ?? '—'}
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Not attached. Creates the customer and prices from the plan above; the
              subscription starts the day the client adds a payment method.
            </p>
            <AttachStripeButton clientId={client.id} />
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="mt-10 border border-red-200 bg-red-50/40 p-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-red-500">Danger zone</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Deleting this pod permanently clears all its imported calls and data to free space.
          </p>
          <DeletePodButton clientId={client.id} name={client.name} />
        </div>
      </div>
    </div>
  )
}
