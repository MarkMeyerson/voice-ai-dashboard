'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/brand'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  // Establish the recovery session from the link (PKCE ?code= or URL hash token).
  useEffect(() => {
    let active = true
    const markReady = () => active && setStatus('ready')

    const code = new URLSearchParams(window.location.search).get('code')
    if (code) supabase.auth.exchangeCodeForSession(code).catch(() => {})

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) markReady()
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady()
    })

    // If no recovery session shows up, the link is bad/expired.
    const t = setTimeout(() => {
      if (active) setStatus((s) => (s === 'checking' ? 'invalid' : s))
    }, 3500)

    return () => {
      active = false
      clearTimeout(t)
      sub.subscription.unsubscribe()
    }
  }, [supabase])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const password = form.get('password') as string
    const confirm = form.get('confirm') as string
    if (!password || password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setPending(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setPending(false)
      return setError(error.message)
    }
    // Sign the recovery session out so they sign in fresh with the new password.
    await supabase.auth.signOut()
    setPending(false)
    setDone(true)
    setTimeout(() => router.push('/login'), 1800)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <Logo className="h-12 w-12" />
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted">VoiceDesk</p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">
              New password
            </h1>
            <p className="text-sm text-muted">Choose a new password to sign in.</p>
          </div>
        </div>

        {done ? (
          <div className="border border-ink/15 bg-card p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-ink/20">
              <span className="h-2 w-2 rounded-full bg-seal" />
            </div>
            <p className="font-serif text-lg text-ink">Password updated</p>
            <p className="mt-1 text-sm text-muted">
              Taking you to sign in with your new password…
            </p>
          </div>
        ) : status === 'invalid' ? (
          <div className="border border-ink/15 bg-card p-8 text-center">
            <p className="font-serif text-lg text-ink">Link expired</p>
            <p className="mt-1 text-sm text-muted">
              This reset link is invalid or has expired.
            </p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-block text-sm text-seal hover:underline"
            >
              Request a new link →
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-6 border border-ink/15 bg-card p-8">
            <label className="block space-y-2">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted">
                New password
              </span>
              <input
                name="password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                disabled={status !== 'ready'}
                className="w-full border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 outline-none transition focus:border-seal disabled:opacity-50"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted">
                Confirm password
              </span>
              <input
                name="confirm"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                disabled={status !== 'ready'}
                className="w-full border-b border-ink/20 bg-transparent pb-2 text-sm text-ink placeholder:text-muted/60 outline-none transition focus:border-seal disabled:opacity-50"
              />
            </label>

            {error && <p className="border-l-2 border-seal pl-3 text-sm text-seal">{error}</p>}

            <button
              type="submit"
              disabled={pending || status !== 'ready'}
              className="group relative w-full bg-ink px-3 py-3 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90 disabled:opacity-60"
            >
              {status === 'checking' ? 'Verifying link…' : pending ? 'Saving…' : 'Update password'}
              <span className="absolute right-4 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-seal" />
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
