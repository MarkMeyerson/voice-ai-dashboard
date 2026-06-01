import { createBrowserClient } from '@supabase/ssr'

// Browser-side Supabase client (used in Client Components).
// Only ever sees the public anon key + the logged-in user's session.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
