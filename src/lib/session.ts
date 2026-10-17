// Mono-user access: a password (APP_ACCESS_PASSWORD, Vercel env) opens a signed session cookie.
// Token format: oh.<expiresAtEpoch>.<hmacSha256(secret, exp)> — verified here and by the backend (same APP_SESSION_SECRET).
import { createHmac, timingSafeEqual } from "crypto"

export const SESSION_COOKIE = "oh_session"
export const APP_USER = {
  id: process.env.APP_USER_ID || "user_3JyIq3WyP0BS44BhxVz3zz60Gos",
  email: process.env.NEXT_PUBLIC_APP_USER_EMAIL || "yassirboudda@gmail.com",
  firstName: process.env.NEXT_PUBLIC_APP_USER_NAME || "Yassir",
}

function secret() {
  return process.env.APP_SESSION_SECRET || ""
}

export function makeToken(ttlSec = 60 * 60 * 24 * 30) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const sig = createHmac("sha256", secret()).update(String(exp)).digest("hex")
  return `oh.${exp}.${sig}`
}

export function verifyToken(token: string | undefined | null) {
  if (!token || !secret()) return false
  const [p, exp, sig] = token.split(".")
  if (p !== "oh" || !exp || !sig || Number(exp) < Date.now() / 1000) return false
  const good = createHmac("sha256", secret()).update(exp).digest("hex")
  return sig.length === good.length && timingSafeEqual(Buffer.from(sig), Buffer.from(good))
}

export function accessConfigured() {
  return Boolean((process.env.APP_ACCESS_PASSWORD || "").trim()) && Boolean(secret().trim())
}

export function passwordOk(pw: string) {
  const want = (process.env.APP_ACCESS_PASSWORD || "").trim()
  const got = pw.trim()
  return !!want && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))
}
