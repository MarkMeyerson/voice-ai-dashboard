'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function SignOut({ className }: { className?: string }) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button onClick={signOut} disabled={pending} className={className}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
