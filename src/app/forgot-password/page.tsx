'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { requestReset, type ForgotState } from './actions'
import { Logo } from '@/components/brand'

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(
    requestReset,
    undefined
  )

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <Logo className="h-12 w-12" />
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted">
              VoiceDesk
            </p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">
              Reset password
            </h1>
            <p className="text-sm text-muted">
              We&apos;ll send a link to set a new one.
            </p>
          </div>
        </div>

        {state?.ok ? (
          <div className="border border-ink/15 bg-card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-ink/20">
              <span className="h-2 w-2 rounded-full bg-seal" />
            </div>
            <p className="font-serif text-lg text-ink">Check your inbox</p>
            <p className="mt-1 text-sm text-muted">
              If an account exists, a reset link is on its way.
            </p>
          </div>
        ) : (
          <form
            action={action}
            className="space-y-6 border border-ink/15 bg-card p-8"
          >
            <label className="block space-y-2">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted">
                Email
              </span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@agency.com"
                className="w-full border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 outline-none transition focus:border-seal"
              />
            </label>

            {state?.error && (
              <p className="border-l-2 border-seal pl-3 text-sm text-seal">
                {state.error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="group relative w-full bg-ink px-3 py-3 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90 disabled:opacity-60"
            >
              {pending ? 'Sending…' : 'Send reset link'}
              <span className="absolute right-4 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-seal" />
            </button>
          </form>
        )}

        <p className="mt-8 text-center text-sm">
          <Link href="/login" className="text-muted transition hover:text-ink">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
