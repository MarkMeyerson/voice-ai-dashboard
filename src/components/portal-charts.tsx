'use client'

import { useMemo, useState } from 'react'
import type { CallRow } from '@/components/call-log'

// ─── helpers ────────────────────────────────────────────────────────────────

function dayKey(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'unknown'
}

function fmtDay(key: string): string {
  if (key === 'unknown') return 'Undated'
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// ─── types ──────────────────────────────────────────────────────────────────

type MetricKey = 'calls' | 'minutes' | 'cost'
type RangeKey = 'week' | 'month' | 'year' | 'all'

interface DayBucket {
  day: string
  calls: number
  minutes: number
  cost: number
}

interface SentimentCounts {
  positive: number
  neutral: number
  negative: number
  unknown: number
}

// ─── sub-components ─────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="bg-card p-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{label}</p>
      <p
        className={`mt-2 font-serif text-3xl font-semibold tracking-tight ${
          accent ? 'text-seal' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative pb-3 text-[12px] uppercase tracking-[0.18em] transition-colors ${
        active ? 'text-ink' : 'text-muted hover:text-ink/70'
      }`}
    >
      {label}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-seal" />
      )}
    </button>
  )
}

function BarChart({
  buckets,
  metric,
}: {
  buckets: DayBucket[]
  metric: MetricKey
}) {
  const values = buckets.map((b) => b[metric])
  const max = Math.max(...values, 0.001) // avoid divide-by-zero

  const formatTip = (b: DayBucket): string => {
    if (metric === 'calls') return `${b.calls} call${b.calls !== 1 ? 's' : ''}`
    if (metric === 'minutes') return `${b.minutes.toFixed(1)} min`
    return fmtDollars(b.cost)
  }

  if (buckets.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="text-sm text-muted">No data yet</p>
      </div>
    )
  }

  // Responsive: limit visible labels to avoid clutter
  const showEveryN = buckets.length > 14 ? Math.ceil(buckets.length / 7) : 1

  return (
    <div className="w-full">
      {/* bars */}
      <div className="flex h-40 items-end gap-[3px]" aria-hidden="true">
        {buckets.map((b) => {
          const pct = (b[metric] / max) * 100
          return (
            <div
              key={b.day}
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
            >
              {/* tooltip */}
              <div className="pointer-events-none absolute bottom-full mb-1.5 hidden whitespace-nowrap rounded border border-ink/15 bg-card px-2 py-1 text-[11px] text-ink shadow-sm group-hover:block">
                <span className="font-medium">{fmtDay(b.day)}</span>
                <span className="ml-2 text-muted">{formatTip(b)}</span>
              </div>
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-seal/70 to-seal transition-all duration-200 group-hover:from-seal/90 group-hover:to-seal"
                style={{ height: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
              />
            </div>
          )
        })}
      </div>

      {/* x-axis labels */}
      <div className="mt-2 flex gap-[3px]" aria-hidden="true">
        {buckets.map((b, i) => (
          <div key={b.day} className="flex-1 overflow-hidden text-center">
            {i % showEveryN === 0 ? (
              <span className="block truncate text-[10px] text-muted">
                {fmtDay(b.day)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function SentimentBar({
  label,
  count,
  total,
  color,
}: {
  label: string
  count: number
  total: number
  color: string
}) {
  const pct = total === 0 ? 0 : (count / total) * 100
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</span>
        <span className="text-sm text-ink">{count}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-ink/8">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── main component ──────────────────────────────────────────────────────────

export default function PortalCharts({
  calls,
  billingStartsAt,
}: {
  calls: CallRow[]
  billingStartsAt?: string
}) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('calls')
  const [range, setRange] = useState<RangeKey>('all')

  // Pre-billing test calls are excluded from every chart and total; they
  // remain visible only in the call log below the divider.
  const billableCalls = useMemo(() => {
    if (!billingStartsAt) return calls
    return calls.filter((c) => c.started_at && c.started_at >= billingStartsAt)
  }, [calls, billingStartsAt])

  // Filter to the selected time range (relative to now).
  const scopedCalls = useMemo(() => {
    if (range === 'all') return billableCalls
    const days = range === 'week' ? 7 : range === 'month' ? 30 : 365
    const cutoff = Date.now() - days * 86400000
    return billableCalls.filter((c) => c.started_at && Date.parse(c.started_at) >= cutoff)
  }, [billableCalls, range])

  // ── overview totals ──────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const totalCalls = scopedCalls.length
    const totalMinutes = scopedCalls.reduce((s, c) => s + c.duration_seconds / 60, 0)
    const totalCents = scopedCalls.reduce((s, c) => s + Number(c.billed_cents), 0)
    const avgMinutes = totalCalls > 0 ? totalMinutes / totalCalls : 0
    return { totalCalls, totalMinutes, totalCents, avgMinutes }
  }, [scopedCalls])

  // ── daily buckets (sorted ascending) ────────────────────────────────────
  const buckets = useMemo((): DayBucket[] => {
    const map = new Map<string, DayBucket>()
    for (const c of scopedCalls) {
      const key = dayKey(c.started_at)
      if (!map.has(key)) {
        map.set(key, { day: key, calls: 0, minutes: 0, cost: 0 })
      }
      const b = map.get(key)!
      b.calls += 1
      b.minutes += c.duration_seconds / 60
      b.cost += Number(c.billed_cents)
    }
    return Array.from(map.values())
      .filter((b) => b.day !== 'unknown')
      .sort((a, b) => a.day.localeCompare(b.day))
  }, [scopedCalls])

  // ── sentiment counts ─────────────────────────────────────────────────────
  const sentiment = useMemo((): SentimentCounts => {
    const counts: SentimentCounts = { positive: 0, neutral: 0, negative: 0, unknown: 0 }
    for (const c of scopedCalls) {
      const s = (c.sentiment ?? '').toLowerCase()
      if (s.includes('positive')) counts.positive++
      else if (s.includes('neutral')) counts.neutral++
      else if (s.includes('negative')) counts.negative++
      else counts.unknown++
    }
    return counts
  }, [scopedCalls])

  const sentimentTotal = scopedCalls.length

  const metrics: { key: MetricKey; label: string }[] = [
    { key: 'calls', label: 'Calls' },
    { key: 'minutes', label: 'Minutes' },
    { key: 'cost', label: 'Cost ($)' },
  ]
  const ranges: { key: RangeKey; label: string }[] = [
    { key: 'week', label: '7d' },
    { key: 'month', label: '30d' },
    { key: 'year', label: '1y' },
    { key: 'all', label: 'All' },
  ]

  // ── empty state ──────────────────────────────────────────────────────────
  if (billableCalls.length === 0) {
    return (
      <div className="border border-ink/15 bg-card px-8 py-16 text-center">
        <p className="font-serif text-xl text-ink">No data yet</p>
        <p className="mt-2 text-sm text-muted">
          Charts will appear once your first billable calls are recorded.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── metric tiles ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile
          label="Total calls"
          value={String(totals.totalCalls)}
        />
        <MetricTile
          label="Total minutes"
          value={totals.totalMinutes.toFixed(1)}
        />
        <MetricTile
          label="Total billed"
          value={fmtDollars(totals.totalCents)}
          accent
        />
        <MetricTile
          label="Avg. duration"
          value={`${totals.avgMinutes.toFixed(1)} min`}
        />
      </div>

      {/* ── bar chart panel ─────────────────────────────────────────────── */}
      <div className="border border-ink/15 bg-card px-6 pb-6 pt-5">
        {/* toggle row */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-ink/10 pb-px">
          <div className="flex items-end gap-7">
            <p className="mb-[11px] text-[11px] uppercase tracking-[0.2em] text-muted">
              Activity
            </p>
            {metrics.map(({ key, label }) => (
              <ToggleButton
                key={key}
                label={label}
                active={activeMetric === key}
                onClick={() => setActiveMetric(key)}
              />
            ))}
          </div>
          <div className="mb-2 flex items-center gap-1">
            {ranges.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={`px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] transition ${
                  range === r.key ? 'bg-ink text-card' : 'text-muted hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* chart */}
        <BarChart buckets={buckets} metric={activeMetric} />

        {/* y-axis hint */}
        <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-muted/60">
          {activeMetric === 'calls' && 'calls per day'}
          {activeMetric === 'minutes' && 'minutes per day'}
          {activeMetric === 'cost' && 'billed per day (cents → $)'}
        </p>
      </div>

      {/* ── sentiment breakdown ─────────────────────────────────────────── */}
      <div className="border border-ink/15 bg-card px-6 py-5">
        <p className="mb-5 text-[11px] uppercase tracking-[0.2em] text-muted">
          Sentiment
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SentimentBar
            label="Positive"
            count={sentiment.positive}
            total={sentimentTotal}
            color="bg-seal"
          />
          <SentimentBar
            label="Neutral"
            count={sentiment.neutral}
            total={sentimentTotal}
            color="bg-ink/40"
          />
          <SentimentBar
            label="Negative"
            count={sentiment.negative}
            total={sentimentTotal}
            color="bg-ink/20"
          />
          {sentiment.unknown > 0 && (
            <SentimentBar
              label="Unknown"
              count={sentiment.unknown}
              total={sentimentTotal}
              color="bg-ink/10"
            />
          )}
        </div>
      </div>
    </div>
  )
}
