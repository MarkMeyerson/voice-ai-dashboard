import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase session on every request and keeps auth cookies in
// sync. Runs from proxy.ts (the Next.js 16 replacement for middleware).
// Optimistic check only — real authorization happens at the data layer + RLS.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  // Stale/invalid session (e.g. the user was deleted) — clear it so the
  // "User from sub claim in JWT does not exist" error stops recurring.
  if (error) {
    await supabase.auth.signOut()
  }

  const path = request.nextUrl.pathname
  const publicPaths = ['/', '/login', '/forgot-password', '/reset-password']
  const isPublic = publicPaths.includes(path) || path.startsWith('/auth')

  // Not signed in and hitting a protected route -> send to login.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return response
}
