import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Profile = {
  id: string
  role: 'admin' | 'client'
  client_id: string | null
  email: string | null
}

// Data Access Layer: one place that resolves the current user's profile.
// cache() dedupes the lookup across a single render pass.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, client_id, email')
    .eq('id', user.id)
    .maybeSingle()

  return profile as Profile | null
})

// Gate an admin-only page/route.
export async function requireAdmin(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/')
  return profile
}
