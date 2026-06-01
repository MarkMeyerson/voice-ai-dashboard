import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

// Next.js 16: this file replaces middleware.ts. Runs before each request to
// refresh the auth session and gate protected routes.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Run on everything except API routes (they handle their own auth/webhooks),
  // static assets, and image files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
