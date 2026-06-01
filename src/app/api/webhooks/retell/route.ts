import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyRetellSignature, callToRow, type RetellCall } from '@/lib/retell'
import { reportUsage } from '@/lib/stripe'

// Receives live call events from Retell across MANY agents / Retell accounts.
// A pod can own multiple agents; each pod can use its own Retell API key.
// Idempotent on retell_call_id.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const signature = request.headers.get('x-retell-signature')

  let parsed: { event?: string; call?: RetellCall }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new NextResponse('bad payload', { status: 400 })
  }
  const { event, call } = parsed
  if (!call?.agent_id) return NextResponse.json({ ignored: 'no agent' })

  const supabase = createAdminClient()

  // Resolve the pod: first via the pod_agents map, then legacy single-agent field.
  let client:
    | { id: string; rate_per_minute_cents: number; stripe_customer_id: string | null; retell_api_key: string | null }
    | null = null

  const { data: pa } = await supabase
    .from('pod_agents')
    .select('client_id')
    .eq('retell_agent_id', call.agent_id)
    .maybeSingle()

  const clientId = pa?.client_id ?? null
  const q = supabase
    .from('clients')
    .select('id, rate_per_minute_cents, stripe_customer_id, retell_api_key')
  const { data } = clientId
    ? await q.eq('id', clientId).maybeSingle()
    : await q.eq('retell_agent_id', call.agent_id).maybeSingle()
  client = data

  if (!client) return NextResponse.json({ skipped: 'no pod for agent' })

  // Verify with the pod's own Retell key, falling back to the global key.
  // NOTE: test mode — if the signature doesn't match we log and still record,
  // so live calls are never silently dropped while we confirm Retell's exact
  // signature scheme against real deliveries. Re-tighten to a 401 for production.
  const key = client.retell_api_key || process.env.RETELL_API_KEY!
  if (!verifyRetellSignature(raw, signature, key)) {
    console.warn(
      `[retell webhook] signature mismatch for agent ${call.agent_id} — recording anyway (test mode)`
    )
  }

  if (event !== 'call_ended' && event !== 'call_analyzed') {
    return NextResponse.json({ ignored: event })
  }

  const row = callToRow(call, client.id, client.rate_per_minute_cents)
  const { error } = await supabase
    .from('calls')
    .upsert(row, { onConflict: 'retell_call_id' })
  if (error) return new NextResponse(error.message, { status: 500 })

  if (event === 'call_ended' && client.stripe_customer_id) {
    try {
      await reportUsage({
        stripeCustomerId: client.stripe_customer_id,
        minutes: row.duration_seconds / 60,
      })
    } catch {
      /* best effort */
    }
  }

  return new NextResponse(null, { status: 204 })
}
