import type { MonthUsage } from '@/lib/usage'

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

function monthName(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Chicago',
  })
}

// Month-to-date message usage against a chat plan's allowance. Server-safe.
// `admin` adds the projection line (clients see the plain numbers only).
export function UsageCard({
  usage,
  ratePerMessageCents,
  admin,
}: {
  usage: MonthUsage
  ratePerMessageCents: number
  admin?: boolean
}) {
  const pct = usage.included > 0 ? Math.min(100, (usage.used / usage.included) * 100) : 0
  const over = usage.overageMessages > 0

  return (
    <div className="border border-ink/15 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-6 py-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
          Messages this month · {monthName(usage.periodStart)}
        </p>
        <p className="text-sm text-muted">
          Day {usage.dayOfMonth} of {usage.daysInMonth}
        </p>
      </div>

      <div className="grid grid-cols-2 divide-y divide-ink/12 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Stat label="Used" value={usage.used.toLocaleString()} accent={over} />
        <Stat label="Included" value={usage.included.toLocaleString()} />
        <Stat label="Remaining" value={usage.remaining.toLocaleString()} />
        <Stat
          label={over ? 'Overage so far' : 'Overage'}
          value={over ? money(usage.overageCents) : '$0.00'}
          sub={over ? `${usage.overageMessages.toLocaleString()} msgs × ${money(ratePerMessageCents)}` : undefined}
          accent={over}
        />
      </div>

      <div className="px-6 pb-5 pt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
          <div
            className={`h-full rounded-full transition-all ${over ? 'bg-seal' : 'bg-ink/50'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {usage.conversations.toLocaleString()} conversation{usage.conversations === 1 ? '' : 's'} so far
          this month.
          {over
            ? ` You are past the included allowance; each additional message is ${money(ratePerMessageCents)}.`
            : usage.included > 0
              ? ` Messages beyond ${usage.included.toLocaleString()} are ${money(ratePerMessageCents)} each.`
              : ''}
        </p>
        {admin && (
          <p className="mt-1 text-xs text-muted">
            <span className="uppercase tracking-[0.14em]">Projection</span> at this pace:{' '}
            <span className="text-ink">{usage.projectedUsed.toLocaleString()}</span> messages,{' '}
            <span className={usage.projectedOverageCents > 0 ? 'text-seal' : 'text-ink'}>
              {money(usage.projectedOverageCents)}
            </span>{' '}
            overage.
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="p-5">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{label}</p>
      <p className={`mt-2 font-serif text-2xl font-semibold tracking-tight ${accent ? 'text-seal' : 'text-ink'}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-muted">{sub}</p>}
    </div>
  )
}
