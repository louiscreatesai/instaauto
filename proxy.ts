import { type NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session"

// API routes that are called without a dashboard session: Meta's webhook deliveries, the
// Instagram login flow and the comment sweeper (it checks CRON_SECRET itself).
// test-login refuses to run in production on its own.
const PUBLIC_API_ROUTES = new Set([
  "/api/instagram/webhook",
  "/api/cron/sweep-comments",
  "/api/instagram/callback",
  "/api/instagram/test-login",
])

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
  if (PUBLIC_API_ROUTES.has(pathname)) return NextResponse.next()

  const sessionUserId = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (!sessionUserId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 })
  }

  // The dashboard passes the account in ?userId=; it must be the account that logged in.
  const requestedUserId = searchParams.get("userId")
  if (requestedUserId && requestedUserId !== sessionUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: "/api/:path*",
}
