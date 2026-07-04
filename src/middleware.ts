import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { v4 as uuidv4 } from 'uuid'

export async function middleware(request: NextRequest) {
  const response = await updateSession(request)

  // visitorId is a non-essential tracking cookie — don't set it if the
  // visitor explicitly rejected cookies via the consent banner.
  const cookieConsent = request.cookies.get('cookie_consent')?.value
  if (cookieConsent !== 'rejected' && !request.cookies.has('visitorId')) {
    response.cookies.set('visitorId', uuidv4(), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      httpOnly: false, // allow client side read
    })
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
