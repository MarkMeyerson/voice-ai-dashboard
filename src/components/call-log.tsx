'use client'

import { useMemo, useState } from 'react'

export type CallRow = {
  id: string
  retell_call_id: string
  call_type: string | null
  from_number: string | null
  started_at: string | null
  duration_seconds: number
  billed_cents: number
  sentiment: string | null
  disconnect_reason: string | null
  recording_url: string | null
  transcript: string | null
  message_count?: number | null
  user_message_count?: number | null
  chat_status?: string | null
  agent_label?: string | null
}

// Chat sessions live in the same table as calls; call_type tells them apart.
export function isChatRow(c: CallRow) {
  return c.call_type === 'chat' || c.call_type === 'api_chat' || c.call_type === 'sms_chat'
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}
function mmss(sec: number) {
  const m = Math.floor(sec / 60)
  return `${m}:${String(sec % 60).padStart(2, '0')}`
}
function phone(n: string | null) {
  if (!n) return '—'
  const d = n.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1'))
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return n
}
function monthKey(iso: string | null) {
  return iso ? iso.slice(0, 7) : 'unknown'
}
function monthLabel(key: string) {
  if (key === 'unknown') return 'Undated'
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

type Sort = 'newest' | 'oldest' | 'longest' | 'costliest'

// Chat pods show conversations and messages; voice pods show calls and
// minutes. `messageBasis` only affects the "Messages" stat label.
export function CallLog({
  calls,
  billingStartsAt,
  mode = 'voice',
  messageBasis = 'agent',
}: {
  calls: CallRow[]
  billingStartsAt?: string
  mode?: 'voice' | 'chat'
  messageBasis?: 'agent' | 'all'
}) {
  const chatMode = mode === 'chat'
  const months = useMemo(() => {
    const set = new Set(calls.map((c) => monthKey(c.started_at)))
    return Array.from(set).sort().reverse()
  }, [calls])

  const [month, setMonth] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('newest')

  const scoped = useMemo(() => {
    let rows = calls
    if (month !== 'all') rows = rows.filter((c) => monthKey(c.started_at) === month)
    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter((c) =>
        [c.transcript, c.sentiment, c.disconnect_reason, c.retell_call_id, c.call_type, c.from_number, c.agent_label]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q))
      )
    }
    const sorted = [...rows]
    sorted.sort((a, b) => {
      if (sort === 'longest') return b.duration_seconds - a.duration_seconds
      if (sort === 'costliest') return Number(b.billed_cents) - Number(a.billed_cents)
      const at = a.started_at ? Date.parse(a.started_at) : 0
      const bt = b.started_at ? Date.parse(b.started_at) : 0
      return sort === 'oldest' ? at - bt : bt - at
    })
    return sorted
  }, [calls, month, query, sort])

  // Insert a billing divider between billed and pre-billing calls (date sort only).
  const withDivider = useMemo(() => {
    type Item = { kind: 'call'; call: CallRow } | { kind: 'divider' }
    if (!billingStartsAt || (sort !== 'newest' && sort !== 'oldest')) {
      return scoped.map((call): Item => ({ kind: 'call', call }))
    }
    const result: Item[] = []
    let inserted = false
    for (const c of scoped) {
      if (!inserted && c.started_at) {
        if (sort === 'newest' && c.started_at < billingStartsAt) {
          result.push({ kind: 'divider' })
          inserted = true
        } else if (sort === 'oldest' && c.started_at >= billingStartsAt) {
          result.push({ kind: 'divider' })
          inserted = true
        }
      }
      result.push({ kind: 'call', call: c })
    }
    return result
  }, [scoped, billingStartsAt, sort])

  // Aggregates count only billable calls — test calls before billingStartsAt
  // stay browsable in the log but never touch the numbers.
  const stats = useMemo(() => {
    const billable = billingStartsAt
      ? scoped.filter((c) => c.started_at && c.started_at >= billingStartsAt)
      : scoped
    const billed = billable.reduce((s, c) => s + Number(c.billed_cents), 0)
    const minutes = billable.reduce((s, c) => s + c.duration_seconds / 60, 0)
    const messages = billable.reduce((s, c) => s + Number(c.message_count ?? 0), 0)
    return { billed, minutes, messages, count: billable.length }
  }, [scoped, billingStartsAt])

  return (
    <div className="space-y-6">
      {/* Stats reflect the current filter */}
      <div className="grid grid-cols-1 divide-y divide-ink/12 border border-ink/15 bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {chatMode ? (
          <>
            <Stat label="Conversations" value={String(stats.count)} />
            <Stat
              label={messageBasis === 'all' ? 'Messages (both sides)' : 'Messages (assistant)'}
              value={stats.messages.toLocaleString()}
              accent
            />
            <Stat label={month === 'all' ? 'Usage value' : 'Usage value'} value={money(stats.billed)} />
          </>
        ) : (
          <>
            <Stat label={month === 'all' ? 'Total billed' : 'Billed'} value={money(stats.billed)} accent />
            <Stat label="Minutes" value={stats.minutes.toFixed(1)} />
            <Stat label="Calls" value={String(stats.count)} />
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={chatMode ? 'Search transcripts, sentiment…' : 'Search transcripts, caller, sentiment…'}
          className="min-w-[240px] flex-1 border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 outline-none transition focus:border-seal"
        />
        <Select value={month} onChange={setMonth}>
          <option value="all">All time</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(v) => setSort(v as Sort)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          {!chatMode && <option value="longest">Longest</option>}
          <option value="costliest">{chatMode ? 'Most messages' : 'Highest cost'}</option>
        </Select>
      </div>

      {/* Table */}
      <div className="border border-ink/15 bg-card">
        <div className="grid grid-cols-[1.3fr_1.1fr_0.6fr_0.7fr_0.9fr] gap-4 border-b border-ink/15 px-6 py-3 text-[11px] uppercase tracking-[0.18em] text-muted">
          <span>Time</span>
          <span>{chatMode ? 'Conversation' : 'Caller'}</span>
          <span>{chatMode ? 'Messages' : 'Length'}</span>
          <span>{chatMode ? 'Usage' : 'Cost'}</span>
          <span>Sentiment</span>
        </div>

        {scoped.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-serif text-lg text-ink">
              {chatMode ? 'No matching conversations' : 'No matching calls'}
            </p>
            <p className="mt-1 text-sm text-muted">Try a different month or search.</p>
          </div>
        ) : (
          withDivider.map((item, i) =>
            item.kind === 'divider' ? (
              <div key="billing-divider" className="relative flex items-center gap-4 border-b border-ink/10 px-6 py-2.5">
                <div className="h-px flex-1 bg-seal/40" />
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-seal">
                  {sort === 'oldest'
                    ? 'Billing starts below this line · older calls above are tests'
                    : 'Billing starts above this line · calls below are tests'}
                </span>
                <div className="h-px flex-1 bg-seal/40" />
              </div>
            ) : (
              (() => {
                const isTest =
                  !!billingStartsAt &&
                  (!item.call.started_at || item.call.started_at < billingStartsAt)
                return (
              <details key={item.call.id} className="group border-b border-ink/10 last:border-0">
                <summary className={`grid cursor-pointer grid-cols-[1.3fr_1.1fr_0.6fr_0.7fr_0.9fr] items-center gap-4 px-6 py-3.5 text-sm marker:content-none hover:bg-ink/[0.02] ${isTest ? 'opacity-55' : ''}`}>
                  <span className="text-ink">
                    {item.call.started_at ? new Date(item.call.started_at).toLocaleString() : '—'}
                  </span>
                  {isChatRow(item.call) ? (
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full border border-seal/60 ${
                          item.call.chat_status === 'ongoing' ? 'bg-seal/60' : ''
                        }`}
                        title={item.call.chat_status === 'ongoing' ? 'Still open' : undefined}
                      />
                      {item.call.agent_label || (chatMode ? 'Chat' : 'Website chat')}
                      {item.call.chat_status === 'ongoing' && (
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted/70">open</span>
                      )}
                    </span>
                  ) : (
                    <span>
                      <span className="font-mono text-[13px] text-ink">{phone(item.call.from_number)}</span>
                      {item.call.agent_label && (
                        <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-seal/80">
                          {item.call.agent_label}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="text-muted">
                    {isChatRow(item.call)
                      ? chatMode
                        ? String(item.call.message_count ?? 0)
                        : `${item.call.message_count ?? 0} msgs`
                      : mmss(item.call.duration_seconds)}
                  </span>
                  <span className="text-ink">
                    {isTest ? <span className="text-[11px] uppercase tracking-wider text-muted">test</span> : money(Number(item.call.billed_cents))}
                  </span>
                  <span className="flex items-center gap-2 text-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-seal" />
                    {item.call.sentiment || '—'}
                  </span>
                </summary>
                <div className="space-y-4 bg-card-2 px-6 py-4 text-sm">
                  <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
                    {isChatRow(item.call) ? (
                      <>
                        <Detail
                          label="Messages"
                          value={`${item.call.message_count ?? 0} assistant · ${item.call.user_message_count ?? 0} user`}
                        />
                        <Detail label="Status" value={item.call.chat_status || '—'} />
                        <Detail label="Conversation ID" value={item.call.retell_call_id} mono />
                      </>
                    ) : (
                      <>
                        <Detail label="Type" value={item.call.call_type || '—'} />
                        <Detail label="End reason" value={item.call.disconnect_reason || '—'} />
                        <Detail label="Call ID" value={item.call.retell_call_id} mono />
                      </>
                    )}
                  </div>
                  {item.call.recording_url && (
                    <div className="border border-ink/15 bg-paper p-3">
                      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">
                        Recording
                      </p>
                      <audio controls preload="none" src={item.call.recording_url} className="w-full">
                        Your browser does not support audio playback.
                      </audio>
                    </div>
                  )}
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted">
                      Transcript
                    </p>
                    <p className="max-h-64 overflow-auto whitespace-pre-wrap leading-relaxed text-ink/80">
                      {item.call.transcript || 'No transcript available.'}
                    </p>
                  </div>
                </div>
              </details>
                )
              })()
            )
          )
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{label}</p>
      <p className={`mt-2 font-serif text-3xl font-semibold tracking-tight ${accent ? 'text-seal' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-ink/20 bg-card px-3 py-2 text-sm text-ink outline-none transition focus:border-seal"
    >
      {children}
    </select>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span>
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}: </span>
      <span className={mono ? 'font-mono text-ink/80' : 'text-ink/80'}>{value}</span>
    </span>
  )
}
