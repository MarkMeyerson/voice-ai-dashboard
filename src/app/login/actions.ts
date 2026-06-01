'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type LoginState = { error: string } | undefined

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  // Route by role: admins to the admin panel, clients to their pod.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, client_id, clients(slug)')
    .eq('id', user!.id)
    .maybeSingle()

  if (profile?.role === 'admin') redirect('/admin')

  const slug = (profile?.clients as { slug?: string } | null)?.slug
  redirect(slug ? `/${slug}` : '/')
}
