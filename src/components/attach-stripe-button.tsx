'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attachStripe } from '@/app/admin/pod-actions'

// Admin: create the Stripe customer + prices for a pod that was created with
// "Set up Stripe later". The subscription itself starts when the client adds
// a payment method (see the Stripe webhook).
export function AttachStripeButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const res = await attachStripe(clientId)
            if (res?.error) setError(res.error)
            else router.refresh()
          })
        }
        className="rounded-full bg-ink px-5 py-2.5 text-sm tracking-wide text-card transition hover:bg-ink/90 disabled:opacity-60"
      >
        {pending ? 'Creating in Stripe…' : 'Attach Stripe'}
      </button>
      {error && <p className="text-[12px] text-seal">{error}</p>}
    </div>
  )
}
