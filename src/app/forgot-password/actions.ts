'use server'

import { createClient } from '@/lib/supabase/server'

export type ForgotState = { ok?: boolean; error?: string } | undefined

export async function requestReset(
  _prev: ForgotState,
  formData: FormData
): Promise<ForgotState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return { error: 'Enter your email.' }

  const supabase = await createClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/reset-password`,
  })

  // Always report success so we don't leak which emails exist.
  if (error && !/rate/i.test(error.message)) {
    return { ok: true }
  }
  return { ok: true }
}
