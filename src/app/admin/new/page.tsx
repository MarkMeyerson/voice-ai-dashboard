import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { PodForm } from '@/components/pod-form'

export default async function NewClientPage() {
  await requireAdmin()

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/admin" className="text-sm text-muted transition hover:text-ink">
        ← Client pods
      </Link>
      <div className="mt-3 mb-8">
        <p className="text-[11px] uppercase tracking-[0.25em] text-muted">New</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink">
          Add a client
        </h1>
      </div>
      <PodForm mode="create" />
    </div>
  )
}
