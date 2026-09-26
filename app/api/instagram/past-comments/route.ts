import { type NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { buildFollowGateCard, sendCardDM, sendTextDM } from "@/lib/instagram-api"

// Comments that arrived before a rule existed never reached the webhook. Instagram still allows a
// private reply to a comment for 7 days, so these routes find a rule's past keyword comments and
// send them what the webhook would have sent (the follow gate card when the rule has one).

const GRAPH = "https://graph.instagram.com/v24.0"

async function load(request: NextRequest, ruleId: string | null) {
  const userId = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (!userId || !ruleId) return null
  const supabase = await getSupabaseServerClient()
  const { data: user } = await supabase.from("users").select("id, username, access_token, business_account_id").eq("id", userId).single()
  const { data: rule } = await supabase.from("automations").select("*").eq("id", ruleId).eq("user_id", userId).single()
  if (!user || !rule || rule.trigger_source !== "comment" || !rule.specific_media_id) return null
  const content = typeof rule.response_content === "string" ? JSON.parse(rule.response_content) : rule.response_content
  return { supabase, user, rule, content }
}

function matches(keywords: string, text: string) {
  return keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))
}

async function keywordComments(ctx: NonNullable<Awaited<ReturnType<typeof load>>>) {
  const url = `${GRAPH}/${ctx.rule.specific_media_id}/comments?fields=id,text,username,timestamp,from&limit=50&access_token=${encodeURIComponent(ctx.user.access_token)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message ?? "Could not read comments")
  return (data.data ?? []).filter(
    (c: any) => c.text && matches(ctx.rule.trigger_value, c.text) && c.from?.id !== ctx.user.business_account_id && c.username !== ctx.user.username,
  )
}

/** GET /api/instagram/past-comments?ruleId= -- the rule's post's comments that match its keyword. */
export async function GET(request: NextRequest) {
  const ctx = await load(request, request.nextUrl.searchParams.get("ruleId"))
  if (!ctx) return NextResponse.json({ error: "Rule not found" }, { status: 404 })
  try {
    const comments = await keywordComments(ctx)
    return NextResponse.json({ comments: comments.map((c: any) => ({ id: c.id, username: c.username, text: c.text, timestamp: c.timestamp })) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}

/** POST /api/instagram/past-comments {ruleId, commentId} -- send one past commenter the rule's DM. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const ctx = await load(request, body.ruleId ?? null)
  if (!ctx) return NextResponse.json({ error: "Rule not found" }, { status: 404 })
  let comment: any
  try {
    comment = (await keywordComments(ctx)).find((c: any) => c.id === body.commentId)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
  if (!comment) return NextResponse.json({ error: "That comment isn't a keyword comment on this rule's post" }, { status: 404 })

  const token = ctx.user.access_token
  let follows: boolean | null = null
  if (ctx.content.check_follow === true && comment.from?.id) {
    const r = await fetch(`${GRAPH}/${comment.from.id}?fields=is_user_follow_business&access_token=${encodeURIComponent(token)}`)
    const j = await r.json().catch(() => ({}))
    follows = r.ok ? j.is_user_follow_business === true : null
  }
  const gate = ctx.content.check_follow === true && follows !== true
  const result = gate
    ? await sendCardDM(token, { comment_id: comment.id }, buildFollowGateCard({ username: ctx.user.username, ruleId: ctx.rule.id }))
    : await sendTextDM(token, { comment_id: comment.id }, ctx.content.message)
  await ctx.supabase.from("webhook_events").insert({
    event_type: "comment_dm_past",
    user_id: ctx.user.id,
    data: { automation: ctx.rule.name, comment_id: comment.id, from: comment.username, follows, sent: gate ? "gate" : "content", dm: result },
  })
  return NextResponse.json({ sent: gate ? "gate" : "content", username: comment.username, result })
}
