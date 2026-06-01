'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { syncCalls } from '@/app/[slug]/actions'

export function SyncButton({ slug }: { slug: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await syncCalls(slug)
          router.refresh()
        })
      }
      disabled={pending}
      className="flex items-center gap-2 border border-ink/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] text-ink transition hover:bg-card disabled:opacity-60"
    >
      {pending ? 'Syncing…' : '↻ Refresh'}
    </button>
  )
}
