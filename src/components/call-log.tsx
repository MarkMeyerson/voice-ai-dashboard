'use client'

import { useMemo, useState } from 'react'

export type CallRow = {
  id: string
  retell_call_id: string
  call_type: string | null
  started_at: string | null
  duration_seconds: number
  billed_cents: number
  sentiment: string | null
  disconnect_reason: string | null
  recording_url: string | null
  transcript: string | null
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}
function mmss(sec: number) {
  const m = Math.floor(sec / 60)
  return `${m}:${String(sec % 60).padStart(2, '0')}`
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

export function CallLog({ calls }: { calls: CallRow[] }) {
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
        [c.transcript, c.sentiment, c.disconnect_reason, c.retell_call_id, c.call_type]
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

  const stats = useMemo(() => {
    const billed = scoped.reduce((s, c) => s + Number(c.billed_cents), 0)
    const minutes = scoped.reduce((s, c) => s + c.duration_seconds / 60, 0)
    return { billed, minutes, count: scoped.length }
  }, [scoped])

  return (
    <div className="space-y-6">
      {/* Stats reflect the current filter */}
      <div className="grid grid-cols-1 divide-y divide-ink/12 border border-ink/15 bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label={month === 'all' ? 'Total billed' : 'Billed'} value={money(stats.billed)} accent />
        <Stat label="Minutes" value={stats.minutes.toFixed(1)} />
        <Stat label="Calls" value={String(stats.count)} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcripts, sentiment, call id…"
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
          <option value="longest">Longest</option>
          <option value="costliest">Highest cost</option>
        </Select>
      </div>

      {/* Table */}
      <div className="border border-ink/15 bg-card">
        <div className="grid grid-cols-[1.4fr_0.7fr_0.8fr_0.7fr_0.9fr] gap-4 border-b border-ink/15 px-6 py-3 text-[11px] uppercase tracking-[0.18em] text-muted">
          <span>Time</span>
          <span>Length</span>
          <span>Type</span>
          <span>Cost</span>
          <span>Sentiment</span>
        </div>

        {scoped.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-serif text-lg text-ink">No matching calls</p>
            <p className="mt-1 text-sm text-muted">Try a different month or search.</p>
          </div>
        ) : (
          scoped.map((c) => (
            <details key={c.id} className="group border-b border-ink/10 last:border-0">
              <summary className="grid cursor-pointer grid-cols-[1.4fr_0.7fr_0.8fr_0.7fr_0.9fr] items-center gap-4 px-6 py-3.5 text-sm marker:content-none hover:bg-ink/[0.02]">
                <span className="text-ink">
                  {c.started_at ? new Date(c.started_at).toLocaleString() : '—'}
                </span>
                <span className="text-muted">{mmss(c.duration_seconds)}</span>
                <span className="text-muted">{c.call_type || '—'}</span>
                <span className="text-ink">{money(Number(c.billed_cents))}</span>
                <span className="flex items-center gap-2 text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-seal" />
                  {c.sentiment || '—'}
                </span>
              </summary>
              <div className="space-y-4 bg-card-2 px-6 py-4 text-sm">
                <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
                  <Detail label="End reason" value={c.disconnect_reason || '—'} />
                  <Detail label="Call ID" value={c.retell_call_id} mono />
                </div>
                {c.recording_url && (
                  <div className="border border-ink/15 bg-paper p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">
                      Recording
                    </p>
                    <audio controls preload="none" src={c.recording_url} className="w-full">
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted">
                    Transcript
                  </p>
                  <p className="max-h-64 overflow-auto whitespace-pre-wrap leading-relaxed text-ink/80">
                    {c.transcript || 'No transcript available.'}
                  </p>
                </div>
              </div>
            </details>
          ))
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
