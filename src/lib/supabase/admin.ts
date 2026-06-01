import { createClient } from '@supabase/supabase-js'

// Service-role Supabase client. BYPASSES row-level security.
// Use ONLY in trusted server code: webhooks (Retell/Stripe), cron jobs,
// admin provisioning. NEVER import this into a Client Component.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
