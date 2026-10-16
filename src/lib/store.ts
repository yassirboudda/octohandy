"use client"

export type Shop = {
  id: string
  marketplace: "vinted" | "leboncoin"
  displayName: string
  status: "connected" | "expired"
  listingCount: number
}

export type StockItem = {
  id: string
  title: string
  sku?: string
  qty: number
  price?: number
  marketplace?: string
  ownerLabel: string
}

export type Team = {
  code: string
  name: string
  members: string[]
  createdAt: string
}

export type ChatMsg = {
  id: string
  role: "user" | "assistant"
  content: string
  images?: string[]
  at: string
}

const KEYS = {
  shops: "stockflow.shops",
  stock: "stockflow.stock",
  team: "stockflow.team",
  chat: "stockflow.chat",
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return
  localStorage.setItem(key, JSON.stringify(value))
}

export function defaultShops(): Shop[] {
  return [
    { id: "s1", marketplace: "vinted", displayName: "lola_du75", status: "connected", listingCount: 42 },
    { id: "s2", marketplace: "leboncoin", displayName: "Leboncoin", status: "expired", listingCount: 8 },
  ]
}

export function defaultStock(ownerLabel: string): StockItem[] {
  return [
    { id: "i1", title: "Masque Halloween", qty: 3, price: 12, marketplace: "vinted", ownerLabel },
    { id: "i2", title: "Veste jean vintage", qty: 1, price: 35, marketplace: "vinted", ownerLabel },
    { id: "i3", title: "Lampe design", qty: 2, price: 45, marketplace: "leboncoin", ownerLabel },
  ]
}

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let out = ""
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

export const store = {
  getShops(): Shop[] {
    const s = read<Shop[] | null>(KEYS.shops, null)
    if (s) return s
    const d = defaultShops()
    write(KEYS.shops, d)
    return d
  },
  setShops(shops: Shop[]) {
    write(KEYS.shops, shops)
  },
  getStock(ownerLabel = "toi"): StockItem[] {
    const s = read<StockItem[] | null>(KEYS.stock, null)
    if (s) return s
    const d = defaultStock(ownerLabel)
    write(KEYS.stock, d)
    return d
  },
  setStock(items: StockItem[]) {
    write(KEYS.stock, items)
  },
  getTeam(): Team | null {
    return read<Team | null>(KEYS.team, null)
  },
  createTeam(name: string, member: string): Team {
    const team: Team = { code: code(), name, members: [member], createdAt: new Date().toISOString() }
    write(KEYS.team, team)
    return team
  },
  joinTeam(inviteCode: string, member: string): Team | null {
    // POV: any code creates/joins a shared local team bucket
    const existing = store.getTeam()
    if (existing && existing.code === inviteCode.toUpperCase()) {
      if (!existing.members.includes(member)) {
        existing.members.push(member)
        write(KEYS.team, existing)
      }
      return existing
    }
    const team: Team = {
      code: inviteCode.toUpperCase(),
      name: `Équipe ${inviteCode.toUpperCase()}`,
      members: existing ? Array.from(new Set([...existing.members, member])) : [member],
      createdAt: new Date().toISOString(),
    }
    write(KEYS.team, team)
    return team
  },
  mergeStockFromPeer(peerLabel: string) {
    const mine = store.getStock()
    const peer = defaultStock(peerLabel).map((i) => ({
      ...i,
      id: `peer-${i.id}-${Date.now()}`,
      ownerLabel: peerLabel,
    }))
    // merge by title+owner unique
    const map = new Map<string, StockItem>()
    for (const i of [...mine, ...peer]) {
      const k = `${i.title}|${i.ownerLabel}`
      const prev = map.get(k)
      if (prev) map.set(k, { ...prev, qty: prev.qty + i.qty })
      else map.set(k, i)
    }
    const merged = Array.from(map.values())
    write(KEYS.stock, merged)
    return merged
  },
  getChat(): ChatMsg[] {
    return read<ChatMsg[]>(KEYS.chat, [])
  },
  setChat(msgs: ChatMsg[]) {
    write(KEYS.chat, msgs)
  },
}
