import { NextResponse } from "next/server"
import { SESSION_COOKIE, accessConfigured, makeToken, passwordOk } from "@/lib/session"

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string }
  if (!accessConfigured()) {
    const missing = [!process.env.APP_ACCESS_PASSWORD?.trim() && "APP_ACCESS_PASSWORD", !process.env.APP_SESSION_SECRET?.trim() && "APP_SESSION_SECRET"].filter(Boolean)
    return NextResponse.json({ error: `Accès non configuré sur Vercel : variable(s) ${missing.join(", ")} manquante(s) — ajoute-les puis redéploie.` }, { status: 503 })
  }
  if (!passwordOk(password ?? "")) {
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 })
  }
  const token = makeToken()
  const res = NextResponse.json({ ok: true })
  // Readable by the client: it is sent as Bearer to the backend (/backend/* rewrite).
  res.cookies.set(SESSION_COOKIE, token, { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 })
  return res
}
