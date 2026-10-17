"use client"

// Same-origin proxy by default (see next.config rewrites → Hetzner). Override with absolute URL if needed.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "/backend").replace(/\/$/, "")

export function apiConfigured() {
  return Boolean(API_BASE)
}

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<T> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_URL manquant")
  const headers: Record<string, string> = { Accept: "application/json" }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `API ${res.status}`)
  }
  return res.json() as Promise<T>
}
