'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { login, type LoginState } from './actions'
import { Logo } from '@/components/brand'

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined
  )

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <Logo className="h-12 w-12" />
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted">
              VoiceDesk
            </p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">
              おかえり
            </h1>
            <p className="text-sm text-muted">Welcome back. Please sign in.</p>
          </div>
        </div>

        <form
          action={action}
          className="space-y-6 border border-ink/15 bg-card p-8 shadow-[0_1px_0_rgba(32,29,22,0.04)]"
        >
          <Field label="Email">
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@agency.com"
              className="w-full border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 outline-none transition focus:border-seal"
            />
          </Field>

          <Field label="Password">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 outline-none transition focus:border-seal"
            />
          </Field>

          <div className="text-right">
            <Link
              href="/forgot-password"
              className="text-xs text-muted transition hover:text-seal"
            >
              Forgot password?
            </Link>
          </div>

          {state?.error && (
            <p className="border-l-2 border-seal pl-3 text-sm text-seal">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="group relative w-full overflow-hidden bg-ink px-3 py-3 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90 disabled:opacity-60"
          >
            {pending ? 'Signing in…' : 'Sign in'}
            <span className="absolute right-4 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-seal" />
          </button>
        </form>

        <p className="mt-8 text-center text-[11px] uppercase tracking-[0.2em] text-muted/70">
          Each client sees only their own calls
        </p>
      </div>
    </main>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-[0.2em] text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}
