'use client'

import { useActionState, useState } from 'react'
import { requestDemo, type DemoRequestState } from '@/app/demo-actions'

// Quiet one-line invitation that unfolds into a tiny form and emails Mark.
export function DemoRequest() {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<DemoRequestState, FormData>(
    requestDemo,
    null
  )

  if (state?.ok) {
    return (
      <p className="mt-8 font-serif text-[15px] italic text-muted">
        Thank you — Mark will reach out shortly.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-8 text-sm font-medium text-seal transition hover:opacity-75"
      >
        Want to try a free demo?
      </button>
    )
  }

  return (
    <form action={action} className="mt-8 w-full max-w-sm">
      <p className="mb-3 text-sm text-muted">
        Leave your email and Mark will set you up with a free demo.
      </p>
      {/* honeypot — humans never see this */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          name="name"
          placeholder="Your name (optional)"
          className="flex-1 border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 transition focus:border-seal"
        />
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="flex-1 border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 transition focus:border-seal"
        />
      </div>
      {state?.error && (
        <p className="mt-2 text-xs text-seal">{state.error}</p>
      )}
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-ink px-6 py-2.5 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90 disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Request demo'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted transition hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
