import { type NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session"

/** GET /api/session -- who is logged in. The proxy already rejects requests without a valid session. */
export async function GET(request: NextRequest) {
  const userId = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  return NextResponse.json({ userId })
}

/** DELETE /api/session -- log out. */
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete(SESSION_COOKIE)
  response.cookies.delete("insta_session")
  return response
}
