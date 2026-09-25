// Signed dashboard session. The cookie value is `<userId>.<expiresAtMs>.<hmac>`, signed with
// SESSION_SECRET, so the API can trust the user id in it -- unlike a `userId` query param,
// which anyone can type. Uses Web Crypto so it runs in the proxy and in route handlers alike.

export const SESSION_COOKIE = "ia_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, in seconds

const encoder = new TextEncoder()

function getSecret(): string | null {
  const secret = process.env.SESSION_SECRET
  return secret && secret.length >= 32 ? secret : null
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("")
}

export async function createSessionToken(userId: string): Promise<string> {
  const secret = getSecret()
  if (!secret) throw new Error("SESSION_SECRET is missing or shorter than 32 characters")
  const payload = `${userId}.${Date.now() + SESSION_MAX_AGE * 1000}`
  return `${payload}.${await sign(payload, secret)}`
}

/** Returns the user id the token was issued for, or null if it is missing, forged or expired. */
export async function verifySessionToken(token: string | undefined): Promise<string | null> {
  const secret = getSecret()
  if (!secret || !token) return null

  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [userId, expiresAt, sig] = parts
  if (!/^[A-Za-z0-9_-]+$/.test(userId) || !(Number(expiresAt) > Date.now())) return null

  const expected = await sign(`${userId}.${expiresAt}`, secret)
  if (sig.length !== expected.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0 ? userId : null
}

/** Usernames allowed to log in, from ALLOWED_INSTAGRAM_USERNAMES. Empty means anyone Meta lets through. */
export function isAllowedUsername(username: string): boolean {
  const allowed = (process.env.ALLOWED_INSTAGRAM_USERNAMES || "")
    .split(",")
    .map((u) => u.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)
  return allowed.length === 0 || allowed.includes(username.toLowerCase())
}
