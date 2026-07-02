import Link from 'next/link'
import { getProfile } from '@/lib/auth'
import { SignOut } from '@/components/sign-out'
import { EnsoPulse, SherpaPeaks, SummitBackdrop } from '@/components/summit'
import { DemoRequest } from '@/components/demo-request'

export default async function Home() {
  const profile = await getProfile()

  return (
    <main className="relative flex min-h-screen flex-col bg-paper">
      <SummitBackdrop />

      <div className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center p-8 text-center">
        <EnsoPulse className="h-[84px] w-[84px]" />

        <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
          The voice-agent portal
        </p>
        <h1 className="mt-3 font-serif text-5xl font-semibold tracking-tight">
          <span className="text-ink">Voice</span>
          <span className="text-seal">Desk</span>
        </h1>

        {/* The exchange — a call, mid-listen */}
        <div className="mt-9 w-full max-w-sm">
          <div className="border-r-2 border-seal/55 pr-3.5 text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              Agent
            </span>
            <span className="mt-1 block font-serif text-[19px] italic leading-relaxed text-seal">
              &ldquo;How can I help today?&rdquo;
            </span>
          </div>
          <div className="mt-4 border-l-2 border-seal/35 pl-3.5 text-left">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              Caller
            </span>
            <span className="mt-1 block font-serif text-[19px] italic leading-relaxed text-ink">
              &ldquo;Well, it&rsquo;s a long story.&rdquo;
            </span>
          </div>
          <div className="mt-4 border-r-2 border-seal/55 pr-3.5 text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              Agent
            </span>
            <span className="mt-1 block font-serif text-[19px] italic leading-relaxed text-seal">
              &ldquo;I have time.&rdquo;
            </span>
          </div>
        </div>

        <p className="mt-7 max-w-sm text-sm leading-relaxed text-muted">
          Voice agents for reception, research, and intake. Every word kept.
        </p>

        <p className="mt-7 text-xs font-medium uppercase tracking-[0.16em] text-muted">
          Reception <span className="px-1 text-seal">·</span> Interviews{' '}
          <span className="px-1 text-seal">·</span> Intake
        </p>

        {profile ? (
          <div className="mt-8 flex flex-col items-center gap-4">
            <p className="text-[13px] text-muted">
              Signed in as <span className="font-medium text-ink">{profile.email}</span>
            </p>
            <div className="flex gap-2.5">
              {profile.role === 'admin' && (
                <Link
                  href="/admin"
                  className="rounded-full bg-ink px-6 py-3 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90"
                >
                  Enter admin
                </Link>
              )}
              <SignOut className="rounded-full border border-ink/20 bg-transparent px-6 py-3 text-sm font-medium tracking-wide text-ink transition hover:bg-card" />
            </div>
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center gap-4">
            <Link
              href="/login"
              className="rounded-full bg-ink px-8 py-3 text-sm font-medium tracking-wide text-card transition hover:bg-ink/90"
            >
              Sign in
            </Link>
          </div>
        )}

        <DemoRequest />
      </div>

      <footer className="relative z-10 pb-6 pt-4 text-center">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-navy opacity-85">
          <SherpaPeaks className="h-2 w-3.5" />
          A SherpaTech.AI property
        </span>
      </footer>
    </main>
  )
}
