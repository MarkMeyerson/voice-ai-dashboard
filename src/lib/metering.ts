import type { SupabaseClient } from '@supabase/supabase-js'
import { reportChatUsage, reportUsage } from '@/lib/stripe'
import { rowMessages, type MessageBasis } from '@/lib/usage'

// Stripe usage reporting, shared by the Retell webhook and the reconcile
// cron. Both paths are "DB first, Stripe second": a usage_events row with a
// deterministic stripe_meter_event_id (UNIQUE) is inserted before the meter
// call, so a crash between the two cannot bill twice, and the same identifier
// is passed to Stripe, which also dedupes it. On a Stripe failure the row is
// removed so the next run retries.

async function sendMetered(args: {
  supabase: SupabaseClient
  clientId: string
  callId: string
  identifier: string
  quantity: number
  report: () => Promise<unknown>
}): Promise<boolean> {
  const { error } = await args.supabase.from('usage_events').insert({
    client_id: args.clientId,
    call_id: args.callId,
    minutes: args.quantity, // the metered quantity: minutes for voice, messages for chat
    stripe_meter_event_id: args.identifier,
  })
  if (error) return false // already reported (unique violation) or DB down
  try {
    await args.report()
    return true
  } catch (e) {
    console.error('[metering] Stripe meter event failed', args.identifier, e)
    await args.supabase.from('usage_events').delete().eq('stripe_meter_event_id', args.identifier)
    return false
  }
}

// Voice: bill a call's minutes exactly once (webhook call_ended, or cron recovery).
export async function reportCallUsageOnce(args: {
  supabase: SupabaseClient
  client: { id: string; stripe_customer_id: string | null; billing_starts_at?: string | null }
  call: { id: string; retell_call_id: string; duration_seconds: number; started_at: string | null }
}): Promise<boolean> {
  const { client, call } = args
  if (!client.stripe_customer_id || call.duration_seconds <= 0) return false
  if (client.billing_starts_at && (call.started_at ?? '') < client.billing_starts_at) return false
  const minutes = call.duration_seconds / 60
  return sendMetered({
    supabase: args.supabase,
    clientId: client.id,
    callId: call.id,
    identifier: `${call.retell_call_id}:minutes`,
    quantity: minutes,
    report: () =>
      reportUsage({
        stripeCustomerId: client.stripe_customer_id!,
        minutes,
        identifier: `${call.retell_call_id}:minutes`,
      }),
  })
}

// Chat: report usage as DELTAS. Ongoing chats grow between polls, so a chat
// may be reported several times; the sum of usage_events.minutes for the call
// is what has been reported so far and only the difference goes to Stripe.
// The identifier embeds the running total, so the same delta is never sent
// twice. Pre-billing chats (before billing_starts_at) are never reported.
export async function reportChatUsageDeltas(args: {
  supabase: SupabaseClient
  client: {
    id: string
    stripe_customer_id: string | null
    billing_starts_at: string | null
    message_basis?: string | null
  }
  rows: {
    id: string
    retell_call_id: string
    message_count: number | null
    user_message_count?: number | null
    started_at: string | null
  }[]
}): Promise<number> {
  const { supabase, client, rows } = args
  if (!client.stripe_customer_id || rows.length === 0) return 0
  const basis: MessageBasis = client.message_basis === 'all' ? 'all' : 'agent'

  const billable = rows
    .map((r) => ({ ...r, metered: rowMessages({ ...r, call_type: 'chat' }, basis) }))
    .filter(
      (r) =>
        r.metered > 0 &&
        (!client.billing_starts_at || (r.started_at ?? '') >= client.billing_starts_at)
    )
  if (billable.length === 0) return 0

  const { data: events } = await supabase
    .from('usage_events')
    .select('call_id, minutes')
    .in('call_id', billable.map((r) => r.id))
  const reported = new Map<string, number>()
  for (const e of events ?? []) {
    if (e.call_id) reported.set(e.call_id, (reported.get(e.call_id) ?? 0) + Number(e.minutes))
  }

  let sent = 0
  for (const r of billable) {
    const soFar = reported.get(r.id) ?? 0
    const delta = r.metered - soFar
    if (delta <= 0) continue
    const identifier = `${r.retell_call_id}:msgs:${soFar}`
    const ok = await sendMetered({
      supabase,
      clientId: client.id,
      callId: r.id,
      identifier,
      quantity: delta,
      report: () =>
        reportChatUsage({ stripeCustomerId: client.stripe_customer_id!, messages: delta, identifier }),
    })
    if (ok) sent += delta
  }
  return sent
}
