import { addPaymentMethod } from '@/app/[slug]/actions'
import { SubmitButton } from '@/components/submit-button'

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export function PaymentMethodCard({
  slug,
  card,
  justAdded,
  billingMode,
  rateCents,
  monthlyCents,
}: {
  slug: string
  card: { brand: string; last4: string } | null
  justAdded?: boolean
  billingMode: string
  rateCents: number
  monthlyCents: number
}) {
  const action = addPaymentMethod.bind(null, slug)

  const planParts: string[] = []
  if (billingMode === 'monthly_plus_usage' && monthlyCents > 0) {
    planParts.push(`${money(monthlyCents)}/mo retainer`)
  }
  planParts.push(`${money(rateCents)} per minute`)

  return (
    <div className="border border-ink/15 bg-card">
      {/* Plan summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-6 py-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Your plan</p>
        <p className="text-sm text-ink">{planParts.join('  ·  ')}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
          Payment method
        </p>
        {card ? (
          <p className="mt-1 text-ink">
            <span className="capitalize">{card.brand}</span> ···· {card.last4}
            <span className="ml-2 text-sm text-muted">
              · billed automatically each month
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            No card on file. Add one and your monthly invoice is charged
            automatically, no manual payments.
          </p>
        )}
        {justAdded && (
          <p className="mt-1 text-sm text-seal">Card saved — you&apos;re all set.</p>
        )}
      </div>

      <form action={action}>
        <SubmitButton
          pendingText="Opening secure checkout…"
          className="group relative bg-ink px-5 py-2.5 text-sm tracking-wide text-card transition hover:bg-ink/90 disabled:opacity-60"
        >
          {card ? 'Update card' : 'Add payment method'}
          <span className="absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-seal" />
        </SubmitButton>
      </form>
      </div>
    </div>
  )
}
