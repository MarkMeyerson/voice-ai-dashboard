// Monthly message metering for chat plans (retainer + included allowance +
// per-message overage). Pure functions; the pages feed them rows from `calls`.

export type MessageBasis = 'agent' | 'all'

export type ChatPlan = {
  included_messages_per_month: number
  chat_rate_per_message_cents: number | null // overage rate
  monthly_price_cents: number
  message_basis: MessageBasis
}

export type UsageRow = {
  started_at: string | null
  message_count?: number | null
  user_message_count?: number | null
  call_type?: string | null
}

// Billing month boundaries for a client in their local time zone. Returns
// ISO strings in UTC so they compare directly with `started_at`.
export function monthBounds(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')!.value)
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)
  const start = zonedMidnightUtc(year, month, 1, timeZone)
  const next = month === 12 ? zonedMidnightUtc(year + 1, 1, 1, timeZone) : zonedMidnightUtc(year, month + 1, 1, timeZone)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start: start.toISOString(), end: next.toISOString(), dayOfMonth: day, daysInMonth }
}

// UTC instant of local midnight on a calendar date in a time zone.
function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day)
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(guess))
  const h = Number(local.find((p) => p.type === 'hour')!.value) % 24
  const m = Number(local.find((p) => p.type === 'minute')!.value)
  // If UTC midnight renders as e.g. 19:00 the previous day locally, the zone
  // is 5h behind UTC, so local midnight is 5h after UTC midnight.
  const offsetMinutes = h * 60 + m
  const behind = offsetMinutes > 12 * 60 ? 24 * 60 - offsetMinutes : -offsetMinutes
  return new Date(guess + behind * 60_000)
}

export function isChatType(callType: string | null | undefined) {
  return callType === 'chat' || callType === 'api_chat' || callType === 'sms_chat' || callType === 'web_chat'
}

// The single definition of "how many messages does this chat meter as".
// `message_count` is ALWAYS assistant turns (0 for greeting-only chats where
// the visitor never typed); `user_message_count` is visitor turns. The basis
// decides whether visitor turns count. Used by chatToRow (billed_cents), the
// usage card, the admin list, the call log and Stripe metering, so they agree.
export function meteredMessages(agentTurns: number, userTurns: number, basis: MessageBasis) {
  if (userTurns === 0) return 0
  return basis === 'all' ? agentTurns + userTurns : agentTurns
}

// Messages a stored row contributes under a basis.
export function rowMessages(row: UsageRow, basis: MessageBasis) {
  return meteredMessages(Number(row.message_count ?? 0), Number(row.user_message_count ?? 0), basis)
}

export type MonthUsage = {
  used: number
  included: number
  remaining: number
  overageMessages: number
  overageCents: number
  conversations: number
  // Straight-line projection from month-to-date pace.
  projectedUsed: number
  projectedOverageMessages: number
  projectedOverageCents: number
  periodStart: string
  periodEnd: string
  dayOfMonth: number
  daysInMonth: number
}

export function monthUsage(
  rows: UsageRow[],
  plan: ChatPlan,
  opts: { now?: Date; timeZone?: string } = {}
): MonthUsage {
  const now = opts.now ?? new Date()
  const { start, end, dayOfMonth, daysInMonth } = monthBounds(now, opts.timeZone ?? 'America/Chicago')
  const inMonth = rows.filter(
    (r) => isChatType(r.call_type) && r.started_at && r.started_at >= start && r.started_at < end
  )
  const used = inMonth.reduce((s, r) => s + rowMessages(r, plan.message_basis), 0)
  const included = plan.included_messages_per_month
  const rate = plan.chat_rate_per_message_cents ?? 0
  const overageMessages = Math.max(0, used - included)
  const projectedUsed = Math.round((used / Math.max(dayOfMonth, 1)) * daysInMonth)
  const projectedOverageMessages = Math.max(0, projectedUsed - included)
  return {
    used,
    included,
    remaining: Math.max(0, included - used),
    overageMessages,
    overageCents: overageMessages * rate,
    conversations: inMonth.length,
    projectedUsed,
    projectedOverageMessages,
    projectedOverageCents: projectedOverageMessages * rate,
    periodStart: start,
    periodEnd: end,
    dayOfMonth,
    daysInMonth,
  }
}
