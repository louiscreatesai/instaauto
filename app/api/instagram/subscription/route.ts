import { type NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session"
import { getSupabaseServerClient } from "@/lib/supabase-server"

// Whether Meta will send this account's comment and DM webhooks to the app. With Instagram Login
// that needs a per-account /me/subscribed_apps call; the login flow makes it, and this route
// reports it (GET) or makes it again (POST) without logging out and back in.

const GRAPH = "https://graph.instagram.com/v24.0"
const FIELDS = "comments,messages,messaging_postbacks,message_reactions"

async function tokenFor(request: NextRequest) {
  const userId = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (!userId) return null
  const supabase = await getSupabaseServerClient()
  const { data } = await supabase.from("users").select("access_token").eq("id", userId).single()
  return data?.access_token ?? null
}

/** GET /api/instagram/subscription -- the webhook fields this account is subscribed to. */
export async function GET(request: NextRequest) {
  const token = await tokenFor(request)
  if (!token) return NextResponse.json({ error: "Not connected" }, { status: 401 })
  const res = await fetch(`${GRAPH}/me/subscribed_apps?access_token=${encodeURIComponent(token)}`)
  const data = await res.json()
  if (!res.ok) return NextResponse.json({ error: data?.error?.message ?? "Request failed" }, { status: 502 })
  const fields: string[] = (data.data ?? []).flatMap((app: any) => app.subscribed_fields ?? [])
  return NextResponse.json({ subscribed: fields.includes("comments") && fields.includes("messages"), fields })
}

/** POST /api/instagram/subscription -- subscribe this account again. */
export async function POST(request: NextRequest) {
  const token = await tokenFor(request)
  if (!token) return NextResponse.json({ error: "Not connected" }, { status: 401 })
  const res = await fetch(`${GRAPH}/me/subscribed_apps?subscribed_fields=${FIELDS}&access_token=${encodeURIComponent(token)}`, {
    method: "POST",
  })
  const data = await res.json()
  if (!res.ok || data.success !== true) {
    return NextResponse.json({ error: data?.error?.message ?? "Subscription failed" }, { status: 502 })
  }
  return NextResponse.json({ success: true })
}
