'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSetupCheckout } from '@/lib/stripe'
import { callToRow, type RetellCall } from '@/lib/retell'

// Starts a hosted Stripe Checkout (setup mode) so the client adds a card once.
export async function addPaymentMethod(slug: string) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  // RLS: client only sees their own pod; admin can see any.
  const { data: client } = await supabase
    .from('clients')
    .select('id, slug, stripe_customer_id')
    .eq('slug', slug)
    .maybeSingle()

  if (!client?.stripe_customer_id) redirect(`/${slug}`)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const session = await createSetupCheckout(
    client.stripe_customer_id,
    `${appUrl}/${slug}`
  )
  redirect(session.url!)
}

// Pull the latest calls for this pod's agents straight from Retell (source of
// truth) and upsert them — independent of webhook delivery.
export async function syncCalls(slug: string) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const { data: client } = await admin
    .from('clients')
    .select('id, rate_per_minute_cents, retell_api_key, retell_agent_id')
    .eq('slug', slug)
    .maybeSingle()
  if (!client) return

  // Clients (RLS) can only act on their own pod; admins on any.
  if (profile.role !== 'admin' && profile.client_id !== client.id) return

  const { data: pa } = await admin
    .from('pod_agents')
    .select('retell_agent_id')
    .eq('client_id', client.id)
  const agentIds = new Set<string>((pa ?? []).map((a) => a.retell_agent_id))
  if (client.retell_agent_id) agentIds.add(client.retell_agent_id)

  const key = client.retell_api_key || process.env.RETELL_API_KEY!
  for (const agentId of agentIds) {
    try {
      const res = await fetch('https://api.retellai.com/v2/list-calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter_criteria: { agent_id: [agentId] }, limit: 100 }),
        cache: 'no-store',
      })
      if (!res.ok) continue
      const calls = (await res.json()) as RetellCall[]
      const rows = calls.map((c) => callToRow(c, client.id, client.rate_per_minute_cents))
      if (rows.length) {
        await admin.from('calls').upsert(rows, { onConflict: 'retell_call_id' })
      }
    } catch {
      /* skip this agent on error */
    }
  }

  revalidatePath(`/${slug}`)
}
