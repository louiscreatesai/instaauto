import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { buildFollowGateCard, replyToComment, sendCardDM, sendTextDM } from "@/lib/instagram-api"

// Safety net for comment webhooks Instagram never sends (seen on 2026-09-29: comments on a new reel
// produced no webhook at all while older posts worked). Every few minutes a GitHub Actions job calls
// this route. It reads the comments on each post that has a keyword rule (plus the latest posts for
// "any post" rules), finds keyword comments with no DM on record, and does what the webhook would
// have done: follow check, DM (or the follow gate card) as a private reply, then the public reply.
// Instagram allows one private reply per comment, so a comment can never be DMed twice.
//
// GET /api/cron/sweep-comments           Authorization: Bearer $CRON_SECRET
// GET /api/cron/sweep-comments?dry=1     same, but only reports what it would send

export const dynamic = "force-dynamic"
export const maxDuration = 60

const GRAPH = "https://graph.instagram.com/v24.0"
const MAX_SENDS = 20 // per run; Instagram caps automated DMs at about 200 an hour
const MIN_AGE_MS = 2 * 60 * 1000 // give the webhook the first two minutes
const MAX_AGE_MS = 7 * 24 * 3600 * 1000 - 3600 * 1000 // private replies are allowed for 7 days
const HANDLED = ["comment_dm", "comment_dm_past", "comment_dm_sweep"]

const PUBLIC_REPLIES = [
  "Sent! 📩 Not in your DMs? Check your message requests",
  "Just sent it 📩 If you can't see it, look in your message requests",
  "Check your DMs 📩 It might be sitting in your message requests",
  "Sent you a message 📩 Check your requests folder if it's not in your inbox",
]
const dmFailedReplies = (keyword: string) => [
  `I couldn't message you, your DMs might be closed 🙈 Send me a DM saying ${keyword} and I'll send it right away`,
  `My DM didn't go through 🙈 Message me the word ${keyword} and I'll send it straight back`,
]
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

function matches(keywords: string, text: string) {
  return String(keywords || "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))
}

function parseContent(raw: any) {
  if (!raw) return {}
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return { message: raw }
    }
  }
  return raw
}

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?"
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10000) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
  return json
}

async function follows(igScopedId: string, token: string): Promise<boolean | null> {
  try {
    const j = await graph(`${igScopedId}?fields=is_user_follow_business`, token)
    return j.is_user_follow_business === true
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1"
  const supabase = await getSupabaseServerClient()
  const { data: users } = await supabase
    .from("users")
    .select("id, username, access_token, business_account_id")
    .not("access_token", "is", null)

  const report: any[] = []
  let sends = 0
  const now = Date.now()

  for (const user of users ?? []) {
    const token = user.access_token as string
    const { data: rules } = await supabase
      .from("automations")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("trigger_source", "comment")
      .eq("trigger_type", "keyword")
    if (!rules?.length) continue
    const postRules = rules.filter((r: any) => r.specific_media_id)
    const anyRules = rules.filter((r: any) => !r.specific_media_id)

    const mediaIds = new Set<string>(postRules.map((r: any) => String(r.specific_media_id)))
    if (anyRules.length) {
      try {
        const m = await graph("me/media?fields=id,timestamp&limit=8", token)
        for (const item of m.data ?? []) if (now - Date.parse(item.timestamp) < MAX_AGE_MS) mediaIds.add(String(item.id))
      } catch (e: any) {
        report.push({ user: user.username, error: `media: ${e.message}` })
      }
    }

    const since = new Date(now - 8 * 24 * 3600 * 1000).toISOString()
    const { data: events } = await supabase
      .from("webhook_events")
      .select("data")
      .eq("user_id", user.id)
      .in("event_type", HANDLED)
      .gte("processed_at", since)
      .limit(20000)
    const done = new Set<string>((events ?? []).map((e: any) => e.data?.comment_id).filter(Boolean))

    const candidates: any[] = []
    for (const mediaId of mediaIds) {
      let path: string | null = `${mediaId}/comments?fields=id,text,timestamp,from,username&limit=50`
      for (let page = 0; path && page < 4; page++) {
        let j: any
        try {
          j = await graph(path, token)
        } catch (e: any) {
          report.push({ user: user.username, media: mediaId, error: `comments: ${e.message}` })
          break
        }
        for (const c of j.data ?? []) {
          if (!c.text || done.has(c.id)) continue
          if (c.from?.id === user.business_account_id || c.username === user.username) continue
          const age = now - Date.parse(c.timestamp)
          if (age < MIN_AGE_MS || age > MAX_AGE_MS) continue
          const rule =
            postRules.find((r: any) => String(r.specific_media_id) === mediaId && matches(r.trigger_value, c.text)) ??
            anyRules.find((r: any) => matches(r.trigger_value, c.text))
          if (rule) candidates.push({ c, rule, mediaId })
        }
        const next: string | undefined = j.paging?.next
        path = next ? next.replace(`${GRAPH}/`, "").replace(/([?&])access_token=[^&]*&?/, "$1") : null
      }
    }

    candidates.sort((a, b) => Date.parse(a.c.timestamp) - Date.parse(b.c.timestamp))
    for (const { c, rule, mediaId } of candidates) {
      if (sends >= MAX_SENDS) break
      const content = parseContent(rule.response_content)
      const replyMode = content.reply_mode || "both"
      if (dry) {
        report.push({ would_send: rule.name, comment_id: c.id, media: mediaId, text: String(c.text).slice(0, 60) })
        continue
      }
      sends++
      let dm: any = null
      let followed: boolean | null = null
      if (replyMode !== "public_only") {
        const gate = content.check_follow === true
        followed = gate && c.from?.id ? await follows(c.from.id, token) : null
        dm =
          gate && followed !== true
            ? await sendCardDM(token, { comment_id: c.id }, buildFollowGateCard({ username: user.username, ruleId: rule.id }))
            : content.message
              ? await sendTextDM(token, { comment_id: c.id }, content.message)
              : { ok: false, error: "rule has no message" }
      }
      let publicReply: any = null
      if (replyMode !== "dm_only") {
        const keyword = String(rule.trigger_value || "").split(",")[0].trim().toUpperCase()
        const failed = replyMode !== "public_only" && dm && dm.ok === false
        const pool = Array.isArray(content.public_replies) && content.public_replies.filter(Boolean).length ? content.public_replies.filter(Boolean) : PUBLIC_REPLIES
        publicReply = await replyToComment(token, c.id, failed && keyword ? pick(dmFailedReplies(keyword)) : pick(pool))
      }
      await supabase.from("webhook_events").insert({
        event_type: "comment_dm_sweep",
        user_id: user.id,
        data: { automation: rule.name, media_id: mediaId, comment_id: c.id, from: c.username ?? c.from?.username ?? c.from?.id, follows: followed, dm, public_reply: publicReply },
      })
      report.push({ sent: rule.name, comment_id: c.id, dm_ok: dm?.ok ?? null, public_ok: publicReply?.ok ?? null })
    }
  }
  return NextResponse.json({ ok: true, dry, sends, report })
}
