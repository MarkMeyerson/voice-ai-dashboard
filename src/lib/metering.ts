import type { SupabaseClient } from '@supabase/supabase-js'
import { reportChatUsage } from '@/lib/stripe'

// Report polled chat usage to the Stripe chat meter as DELTAS. Ongoing chats
// grow between polls, so each chat may be reported several times; the sum of
// usage_events.minutes for a call is what has been reported so far, and only
// the difference goes to Stripe. Pre-billing chats (before billing_starts_at)
// are never reported.
export async function reportChatUsageDeltas(args: {
  supabase: SupabaseClient
  client: { id: string; stripe_customer_id: string | null; billing_starts_at: string | null }
  rows: { id: string; retell_call_id: string; message_count: number | null; started_at: string | null }[]
}): Promise<number> {
  const { supabase, client, rows } = args
  if (!client.stripe_customer_id || rows.length === 0) return 0

  const billable = rows.filter(
    (r) =>
      (r.message_count ?? 0) > 0 &&
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
    const delta = (r.message_count ?? 0) - (reported.get(r.id) ?? 0)
    if (delta <= 0) continue
    try {
      const meterEvent = await reportChatUsage({
        stripeCustomerId: client.stripe_customer_id,
        messages: delta,
      })
      await supabase.from('usage_events').insert({
        client_id: client.id,
        call_id: r.id,
        minutes: delta, // the metered quantity: messages here
        stripe_meter_event_id: meterEvent.identifier,
      })
      sent += delta
    } catch (e) {
      console.error('[metering] reportChatUsage failed', r.retell_call_id, e)
    }
  }
  return sent
}
