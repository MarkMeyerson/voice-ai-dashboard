import { Wordmark } from '@/components/brand'
import { AdminNav } from '@/components/admin-nav'
import { SignOut } from '@/components/sign-out'
import { getProfile } from '@/lib/auth'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getProfile()

  return (
    <div className="flex min-h-screen bg-paper">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-ink/15 px-5 py-6 md:flex">
        <div className="px-1">
          <Wordmark />
        </div>

        <AdminNav />

        <div className="mt-auto border-t border-ink/15 pt-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
            Admin
          </p>
          <p className="mt-1 truncate text-sm text-ink">{profile?.email}</p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-ink/15 px-7 py-4">
          <div className="md:hidden">
            <Wordmark />
          </div>
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden text-sm text-muted sm:inline">
              {profile?.email}
            </span>
            <SignOut className="border border-ink/20 px-3.5 py-1.5 text-sm tracking-wide text-ink transition hover:bg-card" />
          </div>
        </header>
        <div className="flex-1 p-7">{children}</div>
      </div>
    </div>
  )
}
