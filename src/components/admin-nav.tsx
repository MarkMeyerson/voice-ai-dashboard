'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/admin', label: 'Client pods' },
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/settings', label: 'Settings' },
]

export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav className="mt-10 flex flex-col gap-0.5">
      {nav.map(({ href, label }) => {
        const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`group flex items-center gap-3 px-1 py-2.5 text-sm tracking-wide transition ${
              active ? 'text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full transition ${
                active ? 'bg-seal' : 'bg-transparent group-hover:bg-ink/25'
              }`}
            />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
