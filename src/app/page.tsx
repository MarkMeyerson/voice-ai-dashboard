import Link from 'next/link'
import { getProfile } from '@/lib/auth'
import { Logo } from '@/components/brand'
import { SignOut } from '@/components/sign-out'

export default async function Home() {
  const profile = await getProfile()

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-paper p-8 text-center">
      <Logo className="mb-8 h-16 w-16" />

      <p className="mb-3 text-[11px] uppercase tracking-[0.3em] text-muted">
        Voice AI, resold simply
      </p>
      <h1 className="font-serif text-5xl font-semibold tracking-tight text-ink">
        Voice<span className="text-seal">Desk</span>
      </h1>
      <p className="mt-5 max-w-md leading-relaxed text-muted">
        Your clients see their calls. You set the rate. Billing runs itself.
        Nothing more than it needs to be.
      </p>

      <div className="my-9 h-px w-16 bg-ink/20" />

      {profile ? (
        <div className="flex flex-col items-center gap-5">
          <p className="text-sm text-muted">
            Signed in as <span className="text-ink">{profile.email}</span>
            <span className="ml-2 border border-ink/15 px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted">
              {profile.role}
            </span>
          </p>
          <div className="flex gap-3">
            {profile.role === 'admin' && (
              <Link
                href="/admin"
                className="group relative bg-ink px-6 py-3 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90"
              >
                Enter admin
                <span className="absolute right-4 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-seal" />
              </Link>
            )}
            <SignOut className="border border-ink/20 bg-transparent px-6 py-3 text-sm font-medium tracking-wide text-ink transition hover:bg-card" />
          </div>
        </div>
      ) : (
        <Link
          href="/login"
          className="group relative bg-ink px-8 py-3.5 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90"
        >
          Sign in
          <span className="absolute right-5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-seal" />
        </Link>
      )}
    </main>
  )
}
