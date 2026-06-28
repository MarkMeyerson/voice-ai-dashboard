import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PodForm } from '@/components/pod-form'
import { DeletePodButton } from '@/components/delete-pod-button'

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
  const supabase = await createClient()

  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, name, slug, billing_mode, status, rate_per_minute_cents, cost_per_minute_cents, monthly_price_cents, retell_api_key, retell_agent_id, notification_email'
    )
    .eq('slug', slug)
    .maybeSingle()

  if (!client) redirect('/admin')

  const { data: agentRows } = await supabase
    .from('pod_agents')
    .select('retell_agent_id, agent_name')
    .eq('client_id', client.id)
  const { data: users } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('client_id', client.id)

  // Merge the pod's agents from pod_agents + the legacy single-agent field.
  const agentMap = new Map<string, { id: string; name: string }>()
  for (const a of agentRows ?? []) {
    agentMap.set(a.retell_agent_id, { id: a.retell_agent_id, name: a.agent_name ?? 'Agent' })
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
        }}
      />

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
