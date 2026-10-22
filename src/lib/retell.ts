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
function authHeaders(apiKey?: string) {
  return {
    Authorization: `Bearer ${apiKey ?? process.env.RETELL_API_KEY}`,
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
export async function listAgentCalls(
  agentId: string,
  limit = 50,
  apiKey?: string
): Promise<RetellCall[]> {
  const res = await fetch(`${BASE}/v3/list-calls`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ filter_criteria: { agent_id: [agentId] }, limit }),
  })
  if (!res.ok) throw new Error(`listAgentCalls ${res.status}`)
  // v3 wraps the array: { items, pagination_key, has_more }
  const data = (await res.json()) as { items?: RetellCall[] }
  return data.items ?? []
}

// The slice of a Retell chat object we care about (chat agents fire
// chat_started / chat_ended / chat_analyzed with `chat` instead of `call`).
export type RetellChat = {
  chat_id: string
  agent_id: string
  chat_status?: 'ongoing' | 'ended' | 'error'
  chat_type?: string // 'api_chat' | 'sms_chat'
  start_timestamp?: number
  end_timestamp?: number | null
  transcript?: string | null
  chat_analysis?: {
    user_sentiment?: string
    chat_summary?: string
    chat_successful?: boolean
  }
  chat_cost?: { combined_cost?: number }
  message_with_tool_calls?: Array<{ role: string; content?: string }>
}

// List recent chats for the workspace (used by the reconcile safety net).
// NOTE: v3/list-chats returns summaries only — no transcript and no
// message_with_tool_calls. Call getChat() for the full object.
export async function listChats(key: string, limit = 100): Promise<RetellChat[]> {
  const res = await fetch(`${BASE}/v3/list-chats`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`listChats ${res.status}`)
  const data = (await res.json()) as { items?: RetellChat[] }
  return data.items ?? []
}

// Chats for one agent (summaries), newest first, optionally since a timestamp.
export async function listAgentChats(
  agentId: string,
  key: string,
  opts: { limit?: number; sinceMs?: number } = {}
): Promise<RetellChat[]> {
  const filter_criteria: Record<string, unknown> = { agent: [{ agent_id: agentId }] }
  if (opts.sinceMs) {
    filter_criteria.start_timestamp = {
      op: 'bt',
      type: 'range',
      value: [opts.sinceMs, Date.now() + 60_000],
    }
  }
  const res = await fetch(`${BASE}/v3/list-chats`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter_criteria, limit: opts.limit ?? 100 }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`listAgentChats ${res.status}`)
  const data = (await res.json()) as { items?: RetellChat[] }
  return data.items ?? []
}

// Full chat object (transcript + message_with_tool_calls).
export async function getChat(chatId: string, key: string): Promise<RetellChat> {
  const res = await fetch(`${BASE}/get-chat/${chatId}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`getChat ${res.status}`)
  return (await res.json()) as RetellChat
}

// Agents in a workspace, both channels. GET /list-agents was removed
// 2026-07-31; /v2/list-agents is a POST with filters and pagination.
export async function listAgents(
  key: string
): Promise<{ id: string; name: string; channel: 'voice' | 'chat' }[]> {
  const out: { id: string; name: string; channel: 'voice' | 'chat' }[] = []
  for (const channel of ['voice', 'chat'] as const) {
    let paginationKey: string | undefined
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ limit: '1000' })
      if (paginationKey) params.set('pagination_key', paginationKey)
      const res = await fetch(`${BASE}/v2/list-agents?${params}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter_criteria: { channel: { type: 'string', op: 'eq', value: channel } },
        }),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`listAgents ${res.status}`)
      const data = (await res.json()) as {
        items?: { agent_id: string; agent_name?: string }[]
        pagination_key?: string
        has_more?: boolean
      }
      for (const a of data.items ?? []) {
        if (out.some((x) => x.id === a.agent_id)) continue
        out.push({ id: a.agent_id, name: a.agent_name || 'Unnamed', channel })
      }
      if (!data.has_more || !data.pagination_key) break
      paginationKey = data.pagination_key
    }
  }
  return out
}

// Per-role turn counts. Tool-call entries are never messages.
export function chatTurnCounts(chat: RetellChat) {
  let agent = 0
  let user = 0
  for (const m of chat.message_with_tool_calls ?? []) {
    if (m.role === 'agent') agent++
    else if (m.role === 'user') user++
  }
  return { agent, user }
}

// Map a Retell chat to a row in our `calls` table. `message_count` is the
// metered quantity under the pod's basis: 'agent' = assistant turns only
// (mirrors Retell's own per-message cost basis), 'all' = assistant + user.
export function chatToRow(
  chat: RetellChat,
  clientId: string,
  ratePerMessageCents: number,
  basis: 'agent' | 'all' = 'agent'
) {
  const turns = chatTurnCounts(chat)
  // A chat where the visitor never typed is just the automatic greeting
  // (widget opened and closed); it is stored but meters as zero messages.
  const metered =
    turns.user === 0 ? 0 : basis === 'all' ? turns.agent + turns.user : turns.agent
  const durationSeconds =
    chat.start_timestamp && chat.end_timestamp
      ? Math.max(0, Math.round((chat.end_timestamp - chat.start_timestamp) / 1000))
      : 0
  return {
    client_id: clientId,
    retell_call_id: chat.chat_id,
    call_type: chat.chat_type ?? 'chat',
    chat_status: chat.chat_status ?? null,
    started_at: chat.start_timestamp
      ? new Date(chat.start_timestamp).toISOString()
      : null,
    duration_seconds: durationSeconds,
    cost_cents: chat.chat_cost?.combined_cost ?? 0,
    billed_cents: metered * ratePerMessageCents,
    message_count: metered,
    user_message_count: turns.user,
    from_number: null,
    to_number: null,
    transcript: chat.transcript ?? null,
    recording_url: null,
    sentiment: chat.chat_analysis?.user_sentiment ?? null,
    disconnect_reason: null,
    raw: chat,
  }
}

// Poll one chat agent and upsert every chat in the window: ongoing chats are
// re-upserted so message counts keep growing until Retell ends them. Returns
// the chat ids touched. Shared by the reconcile cron, the Refresh button and
// the create-pod backfill.
export async function syncAgentChats(args: {
  agentId: string
  key: string
  clientId: string
  ratePerMessageCents: number
  basis: 'agent' | 'all'
  agentLabel?: string | null
  sinceMs?: number
  limit?: number
  upsert: (rows: ReturnType<typeof chatToRow>[]) => Promise<void>
}): Promise<string[]> {
  const summaries = await listAgentChats(args.agentId, args.key, {
    sinceMs: args.sinceMs,
    limit: args.limit,
  })
  const rows: (ReturnType<typeof chatToRow> & { agent_label: string | null })[] = []
  for (const s of summaries) {
    try {
      const full = await getChat(s.chat_id, args.key)
      rows.push({
        ...chatToRow(full, args.clientId, args.ratePerMessageCents, args.basis),
        agent_label: args.agentLabel ?? null,
      })
    } catch (e) {
      console.error('[retell] getChat failed', s.chat_id, e)
    }
  }
  if (rows.length) await args.upsert(rows)
  return rows.map((r) => r.retell_call_id)
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
