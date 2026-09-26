import { type NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session"
import { getSupabaseServerClient } from "@/lib/supabase-server"

/**
 * GET /api/instagram/events -- the last webhook outcomes for this account: each comment the
 * webhook saw and what happened (no keyword match, own comment, DM sent or Instagram's error),
 * plus deliveries that failed the signature check or matched no account (those have no user).
 */
export async function GET(request: NextRequest) {
  const userId = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (!userId) return NextResponse.json({ error: "Not logged in" }, { status: 401 })
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase
    .from("webhook_events")
    .select("event_type, data, processed_at, user_id")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("processed_at", { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data })
}
