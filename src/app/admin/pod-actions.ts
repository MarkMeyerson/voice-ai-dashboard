'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  stripe,
  createCustomer,
  createMeteredPrice,
  createMonthlyPrice,
  createSubscription,
} from '@/lib/stripe'
import { callToRow, listAgentCalls, listAgents, syncAgentChats } from '@/lib/retell'
import { sendInviteEmail } from '@/lib/email'

// Delete a pod and everything tied to it (calls, agents, invoices, usage all
// cascade via FK on delete). Also cancels the Stripe subscription, removes the
// client logins, and detaches the agents' webhooks.
export async function deleteClientPod(clientId: string) {
  await requireAdmin()
  const admin = createAdminClient()

  const { data: client } = await admin
    .from('clients')
    .select('id, stripe_subscription_id, retell_api_key')
    .eq('id', clientId)
    .maybeSingle()
  if (!client) redirect('/admin')

  if (client.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(client.stripe_subscription_id)
    } catch {
      /* best effort */
    }
  }

  // Detach webhooks from this pod's agents so they stop sending us calls.
  const key = client.retell_api_key || process.env.RETELL_API_KEY
  const { data: agents } = await admin
    .from('pod_agents')
    .select('retell_agent_id')
    .eq('client_id', clientId)
  for (const a of agents ?? []) {
    try {
      await fetch(`https://api.retellai.com/update-agent/${a.retell_agent_id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: '' }),
      })
    } catch {
      /* best effort */
    }
  }

  // Remove the client's login users (auth + profile).
  const { data: users } = await admin
    .from('profiles')
    .select('id')
    .eq('client_id', clientId)
  for (const u of users ?? []) {
    try {
      await admin.auth.admin.deleteUser(u.id)
    } catch {
      /* best effort */
    }
  }

  // Delete the pod — cascades calls, pod_agents, invoices, usage_events.
  await admin.from('clients').delete().eq('id', clientId)

  revalidatePath('/admin')
  redirect('/admin')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dollarsToCents(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? '0'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function tryParseArray<T>(json: string | null | undefined): T[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 1. fetchAgents
// ---------------------------------------------------------------------------

export type AgentOption = { id: string; name: string; channel: 'voice' | 'chat' }

// Lists voice AND chat agents. An empty key means "use the workspace key"
// (RETELL_API_KEY), which is where single-workspace clients like WFWC live.
export async function fetchAgents(
  apiKey: string
): Promise<{ agents?: AgentOption[]; error?: string }> {
  await requireAdmin()

  const key = apiKey.trim() || process.env.RETELL_API_KEY || ''
  if (!key.startsWith('key_')) {
    return { error: 'Enter a valid Retell API key.' }
  }

  try {
    return { agents: await listAgents(key) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return {
      error: msg.includes('listAgents ')
        ? `Retell rejected that key (${msg.replace('listAgents ', '')}).`
        : 'Could not reach Retell.',
    }
  }
}

// Chat-plan fields shared by create + update. Overage/usage rate is stored in
// the existing chat_rate_per_message_cents column.
function chatPlanFields(formData: FormData) {
  const channel: 'voice' | 'chat' =
    String(formData.get('channel') ?? 'voice') === 'chat' ? 'chat' : 'voice'
  const includedRaw = parseInt(String(formData.get('included_messages') ?? '0'), 10)
  const basis: 'agent' | 'all' =
    String(formData.get('message_basis') ?? 'agent') === 'all' ? 'all' : 'agent'
  const ingest: 'webhook' | 'poll' =
    String(formData.get('ingest_mode') ?? 'webhook') === 'poll' ? 'poll' : 'webhook'
  return {
    channel,
    included_messages_per_month: Number.isFinite(includedRaw) ? Math.max(0, includedRaw) : 0,
    chat_rate_per_message_cents: dollarsToCents(formData.get('rate_per_message')) || null,
    message_basis: basis,
    ingest_mode: ingest,
  }
}

async function backfillChatAgents(args: {
  admin: ReturnType<typeof createAdminClient>
  clientId: string
  key: string
  agents: AgentOption[]
  ratePerMessageCents: number
  basis: 'agent' | 'all'
}) {
  for (const a of args.agents.filter((x) => x.channel === 'chat')) {
    try {
      await syncAgentChats({
        agentId: a.id,
        key: args.key,
        clientId: args.clientId,
        ratePerMessageCents: args.ratePerMessageCents,
        basis: args.basis,
        limit: 100,
        upsert: async (rows) => {
          await args.admin.from('calls').upsert(rows, { onConflict: 'retell_call_id' })
        },
      })
    } catch (e) {
      console.error(`chat backfill failed for agent ${a.id}`, e)
    }
  }
}

// ---------------------------------------------------------------------------
// 2. createClientPod
// ---------------------------------------------------------------------------

export async function createClientPod(formData: FormData): Promise<void> {
  await requireAdmin()
  const admin = createAdminClient()

  const name = String(formData.get('name') ?? '').trim()
  const rawSlug = String(formData.get('slug') ?? '').trim()
  const slug = slugify(rawSlug || name)
  const retell_api_key = String(formData.get('retell_api_key') ?? '').trim()
  const billing_mode = String(formData.get('billing_mode') ?? 'per_minute')
  const password = String(formData.get('password') ?? '').trim()

  const rate_per_minute_cents = dollarsToCents(formData.get('rate_per_minute'))
  const cost_per_minute_cents = dollarsToCents(formData.get('cost_per_minute'))
  const monthly_price_cents = dollarsToCents(formData.get('monthly_price'))

  const agents = tryParseArray<AgentOption>(formData.get('agents') as string | null).map(
    (a) => ({ ...a, channel: a.channel === 'chat' ? ('chat' as const) : ('voice' as const) })
  )
  const emails = tryParseArray<string>(
    formData.get('emails') as string | null
  )
  const notification_email = String(formData.get('notification_email') ?? '').trim() || null
  const plan = chatPlanFields(formData)
  // "Set up Stripe later": create the pod with no customer/subscription so a
  // chat plan can be attached deliberately (tiered overage price) instead of
  // the per-minute default. Nothing in Stripe is touched.
  const skipStripe = String(formData.get('skip_stripe') ?? '') === '1'

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // --- Stripe: customer + metered (and optional monthly) subscription ---
  let stripeCustomerId: string | null = null
  let stripeSubscriptionId: string | null = null
  if (!skipStripe) try {
    const customer = await createCustomer({
      name,
      email: emails[0] || '',
      slug,
    })
    stripeCustomerId = customer.id

    const priceIds: string[] = []
    const metered = await createMeteredPrice({
      clientName: name,
      ratePerMinuteCents: rate_per_minute_cents,
    })
    priceIds.push(metered.id)

    if (billing_mode === 'monthly_plus_usage' && monthly_price_cents > 0) {
      const monthly = await createMonthlyPrice({
        clientName: name,
        monthlyCents: monthly_price_cents,
      })
      priceIds.push(monthly.id)
    }

    const sub = await createSubscription({
      customerId: customer.id,
      priceIds,
    })
    stripeSubscriptionId = sub.id
  } catch (e) {
    console.error('stripe setup failed', e)
  }

  // --- Insert the client pod ---
  const { data: client, error: clientError } = await admin
    .from('clients')
    .insert({
      name,
      slug,
      retell_api_key: retell_api_key || null,
      retell_agent_id: agents[0]?.id ?? null,
      billing_mode,
      rate_per_minute_cents,
      cost_per_minute_cents,
      monthly_price_cents,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      notification_email,
      status: 'active',
      ...plan,
    })
    .select('id')
    .single()

  if (clientError || !client) {
    throw new Error(`Could not create client: ${clientError?.message}`)
  }

  const clientId: string = client.id

  // --- pod_agents: upsert all selected agents ---
  for (const a of agents) {
    try {
      await admin
        .from('pod_agents')
        .upsert(
          { client_id: clientId, retell_agent_id: a.id, agent_name: a.name, channel: a.channel },
          { onConflict: 'retell_agent_id', ignoreDuplicates: true }
        )
    } catch (e) {
      console.error(`pod_agents upsert failed for ${a.id}`, e)
    }
  }

  // --- Set each agent's webhook using the pod's own API key ---
  // Poll-mode pods keep whatever webhook the agent already has (it belongs
  // to another service); the cron pulls their chats instead.
  if (retell_api_key && plan.ingest_mode !== 'poll') {
    for (const a of agents) {
      try {
        const res = await fetch(
          `https://api.retellai.com/update-agent/${a.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${retell_api_key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              webhook_url: `${appUrl}/api/webhooks/retell`,
            }),
          }
        )
        if (!res.ok) {
          console.error(
            `set webhook failed for ${a.id}: ${res.status}`,
            await res.text()
          )
        }
      } catch (e) {
        console.error(`set webhook error for ${a.id}`, e)
      }
    }
  }

  // --- Create auth user + profile for each email ---
  for (const email of emails) {
    try {
      const { data: created } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: password || crypto.randomUUID(),
      })

      if (created?.user) {
        await admin.from('profiles').insert({
          id: created.user.id,
          client_id: clientId,
          role: 'client',
          email,
        })

        if (!password) {
          const { data: link } = await admin.auth.admin.generateLink({
            type: 'recovery',
            email,
            options: { redirectTo: `${appUrl}/reset-password` },
          })
          const inviteUrl = link?.properties?.action_link || `${appUrl}/login`
          await sendInviteEmail({ to: email, clientName: name, inviteUrl })
        }
      }
    } catch (e) {
      console.error(`user creation failed for ${email}`, e)
    }
  }

  // --- Backfill recent chats for chat agents (pod key or workspace key) ---
  const backfillKey = retell_api_key || process.env.RETELL_API_KEY || ''
  if (backfillKey) {
    await backfillChatAgents({
      admin,
      clientId,
      key: backfillKey,
      agents,
      ratePerMessageCents: plan.chat_rate_per_message_cents ?? 0,
      basis: plan.message_basis,
    })
  }

  // --- Backfill recent calls for each voice agent using the pod's key ---
  if (retell_api_key) {
    for (const a of agents.filter((x) => x.channel !== 'chat')) {
      try {
        // Use the pod's own Retell key, not the global env var.
        const calls = await listAgentCalls(a.id, 50, retell_api_key)
        if (calls.length) {
          const rows = calls.map((c) =>
            callToRow(c, clientId, rate_per_minute_cents)
          )
          await admin
            .from('calls')
            .upsert(rows, { onConflict: 'retell_call_id' })
        }
      } catch (e) {
        console.error(`backfill failed for agent ${a.id}`, e)
      }
    }
  }

  redirect('/admin')
}

// ---------------------------------------------------------------------------
// 3. updateClientPod
// ---------------------------------------------------------------------------

export async function updateClientPod(formData: FormData): Promise<void> {
  await requireAdmin()
  const admin = createAdminClient()

  const client_id = String(formData.get('client_id') ?? '').trim()
  if (!client_id) throw new Error('client_id is required')

  const name = String(formData.get('name') ?? '').trim()
  const retell_api_key = String(formData.get('retell_api_key') ?? '').trim()
  const billing_mode = String(formData.get('billing_mode') ?? 'per_minute')
  const status = String(formData.get('status') ?? 'active')
  const notification_email = String(formData.get('notification_email') ?? '').trim() || null

  const rate_per_minute_cents = dollarsToCents(formData.get('rate_per_minute'))
  const cost_per_minute_cents = dollarsToCents(formData.get('cost_per_minute'))
  const monthly_price_cents = dollarsToCents(formData.get('monthly_price'))
  const plan = chatPlanFields(formData)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // --- Update scalar client fields ---
  const { error: updateError } = await admin
    .from('clients')
    .update({
      name: name || undefined,
      retell_api_key: retell_api_key || null,
      billing_mode,
      status,
      rate_per_minute_cents,
      cost_per_minute_cents,
      monthly_price_cents,
      notification_email,
      ...plan,
    })
    .eq('id', client_id)

  if (updateError) {
    throw new Error(`Could not update client: ${updateError.message}`)
  }

  // --- Add new agents ---
  const add_agents = tryParseArray<AgentOption>(
    formData.get('add_agents') as string | null
  ).map((a) => ({ ...a, channel: a.channel === 'chat' ? ('chat' as const) : ('voice' as const) }))

  for (const a of add_agents) {
    try {
      await admin
        .from('pod_agents')
        .upsert(
          { client_id, retell_agent_id: a.id, agent_name: a.name, channel: a.channel },
          { onConflict: 'retell_agent_id', ignoreDuplicates: true }
        )

      // Set webhook using the pod's key (never for poll-mode pods)
      if (retell_api_key && plan.ingest_mode !== 'poll') {
        const res = await fetch(
          `https://api.retellai.com/update-agent/${a.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${retell_api_key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              webhook_url: `${appUrl}/api/webhooks/retell`,
            }),
          }
        )
        if (!res.ok) {
          console.error(
            `set webhook failed for ${a.id}: ${res.status}`,
            await res.text()
          )
        }
      }
    } catch (e) {
      console.error(`add agent failed for ${a.id}`, e)
    }
  }

  // --- Backfill chats for newly added chat agents ---
  const backfillKey = retell_api_key || process.env.RETELL_API_KEY || ''
  if (backfillKey && add_agents.some((a) => a.channel === 'chat')) {
    await backfillChatAgents({
      admin,
      clientId: client_id,
      key: backfillKey,
      agents: add_agents,
      ratePerMessageCents: plan.chat_rate_per_message_cents ?? 0,
      basis: plan.message_basis,
    })
  }

  // --- Remove agents ---
  const remove_agent_ids = tryParseArray<string>(
    formData.get('remove_agent_ids') as string | null
  )

  if (remove_agent_ids.length) {
    try {
      await admin
        .from('pod_agents')
        .delete()
        .eq('client_id', client_id)
        .in('retell_agent_id', remove_agent_ids)
    } catch (e) {
      console.error('remove agents failed', e)
    }
  }

  // --- Add new user emails ---
  const add_emails = tryParseArray<string>(
    formData.get('add_emails') as string | null
  )

  // Fetch client name for invite email if not provided
  let clientName = name
  if (!clientName) {
    try {
      const { data: existing } = await admin
        .from('clients')
        .select('name')
        .eq('id', client_id)
        .single()
      if (existing?.name) clientName = existing.name as string
    } catch {
      // best effort
    }
  }

  for (const email of add_emails) {
    try {
      const { data: created } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID(),
      })

      if (created?.user) {
        await admin.from('profiles').insert({
          id: created.user.id,
          client_id,
          role: 'client',
          email,
        })

        const { data: link } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${appUrl}/reset-password` },
        })
        const inviteUrl = link?.properties?.action_link || `${appUrl}/login`
        await sendInviteEmail({ to: email, clientName, inviteUrl })
      }
    } catch (e) {
      console.error(`add email user failed for ${email}`, e)
    }
  }

  // --- Remove users ---
  const remove_user_ids = tryParseArray<string>(
    formData.get('remove_user_ids') as string | null
  )

  for (const userId of remove_user_ids) {
    try {
      await admin.auth.admin.deleteUser(userId)
      await admin.from('profiles').delete().eq('id', userId)
    } catch (e) {
      console.error(`remove user failed for ${userId}`, e)
    }
  }

  redirect('/admin')
}
