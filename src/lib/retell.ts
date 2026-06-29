import crypto from 'crypto'
import Retell from 'retell-sdk'

// Server-side Retell API client (used to set agent webhook URLs, pull calls, etc.)
export function retellClient() {
  return new Retell({ apiKey: process.env.RETELL_API_KEY! })
}

// Verify an inbound Retell webhook.
// Retell signature header format: "v=<timestamp>,d=<hmac-sha256-hex>"
// HMAC key = apiKey, HMAC input = rawBody + timestamp (concatenated, no separator).
export function verifyRetellSignature(
  rawBody: string,
  signature: string | null,
  apiKey: string
): boolean {
  if (!signature) return false
  // Parse "v=<ts>,d=<hex>"
  const tsMatch = signature.match(/v=(\d+)/)
  const digestMatch = signature.match(/d=([0-9a-f]+)/)
  if (!tsMatch || !digestMatch) return false
  const timestamp = tsMatch[1]
  const receivedHex = digestMatch[1]
  const expected = crypto
    .createHmac('sha256', apiKey)
    .update(rawBody + timestamp, 'utf8')
    .digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(receivedHex)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// The slice of a Retell call object we care about.
export type RetellCall = {
  call_id: string
  agent_id: string
  call_type?: string
  call_status?: string
  start_timestamp?: number
  end_timestamp?: number
  duration_ms?: number
  from_number?: string | null
  to_number?: string | null
  transcript?: string | null
  recording_url?: string | null
  disconnection_reason?: string | null
  call_analysis?: { user_sentiment?: string; call_successful?: boolean }
  call_cost?: { combined_cost?: number; total_duration_seconds?: number }
}

const BASE = 'https://api.retellai.com'
function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

// Point an agent's webhook at our endpoint so its calls flow into the dashboard.
export async function setAgentWebhook(agentId: string, webhookUrl: string) {
  const res = await fetch(`${BASE}/update-agent/${agentId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ webhook_url: webhookUrl }),
  })
  if (!res.ok) throw new Error(`setAgentWebhook ${res.status}: ${await res.text()}`)
  return res.json()
}

// Pull recent calls for an agent (used to backfill a new pod).
export async function listAgentCalls(agentId: string, limit = 50): Promise<RetellCall[]> {
  const res = await fetch(`${BASE}/v2/list-calls`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ filter_criteria: { agent_id: [agentId] }, limit }),
  })
  if (!res.ok) throw new Error(`listAgentCalls ${res.status}`)
  return res.json()
}

// Map a Retell call to a row in our `calls` table. Shared by webhook + backfill.
export function callToRow(
  call: RetellCall,
  clientId: string,
  ratePerMinuteCents: number
) {
  const durationSeconds =
    call.call_cost?.total_duration_seconds ??
    Math.round((call.duration_ms ?? 0) / 1000)
  const costCents = call.call_cost?.combined_cost ?? 0
  const billedCents = (durationSeconds / 60) * ratePerMinuteCents
  return {
    client_id: clientId,
    retell_call_id: call.call_id,
    call_type: call.call_type ?? null,
    started_at: call.start_timestamp
      ? new Date(call.start_timestamp).toISOString()
      : null,
    duration_seconds: durationSeconds,
    cost_cents: costCents,
    billed_cents: billedCents,
    from_number: call.from_number ?? null,
    to_number: call.to_number ?? null,
    transcript: call.transcript ?? null,
    recording_url: call.recording_url ?? null,
    sentiment: call.call_analysis?.user_sentiment ?? null,
    disconnect_reason: call.disconnection_reason ?? null,
    raw: call,
  }
}
