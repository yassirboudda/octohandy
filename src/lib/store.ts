"use client"

export type Shop = {
  id: string
  marketplace: "vinted" | "leboncoin"
  displayName: string
  status: "connected" | "expired"
  listingCount: number
}

export type Listing = {
  id: string
  shopId: string
  marketplace: "vinted" | "leboncoin"
  title: string
  price: number
  status: "active" | "sold" | "reserved"
  imageUrl?: string
  url?: string
  views?: number
  favorites?: number
  updatedAt: string
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
  listings: "stockflow.listings",
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
    { id: "s1", marketplace: "vinted", displayName: "lola_du75", status: "connected", listingCount: 6 },
    { id: "s2", marketplace: "leboncoin", displayName: "Leboncoin", status: "connected", listingCount: 4 },
  ]
}

export function defaultListings(): Listing[] {
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
  return [
    {
      id: "l1",
      shopId: "s1",
      marketplace: "vinted",
      title: "Masque Halloween LED",
      price: 12,
      status: "active",
      views: 48,
      favorites: 6,
      updatedAt: day(0),
      url: "https://www.vinted.fr",
    },
    {
      id: "l2",
      shopId: "s1",
      marketplace: "vinted",
      title: "Veste jean vintage",
      price: 35,
      status: "active",
      views: 120,
      favorites: 18,
      updatedAt: day(1),
      url: "https://www.vinted.fr",
    },
    {
      id: "l3",
      shopId: "s1",
      marketplace: "vinted",
      title: "Sneakers blanches 40",
      price: 28,
      status: "reserved",
      views: 90,
      favorites: 11,
      updatedAt: day(2),
      url: "https://www.vinted.fr",
    },
    {
      id: "l4",
      shopId: "s1",
      marketplace: "vinted",
      title: "Sac bandoulière cuir",
      price: 42,
      status: "active",
      views: 33,
      favorites: 4,
      updatedAt: day(3),
      url: "https://www.vinted.fr",
    },
    {
      id: "l5",
      shopId: "s1",
      marketplace: "vinted",
      title: "Pull oversize beige",
      price: 18,
      status: "sold",
      views: 210,
      favorites: 27,
      updatedAt: day(5),
      url: "https://www.vinted.fr",
    },
    {
      id: "l6",
      shopId: "s1",
      marketplace: "vinted",
      title: "Montre minimaliste",
      price: 55,
      status: "active",
      views: 67,
      favorites: 9,
      updatedAt: day(4),
      url: "https://www.vinted.fr",
    },
    {
      id: "l7",
      shopId: "s2",
      marketplace: "leboncoin",
      title: "Lampe design scandinave",
      price: 45,
      status: "active",
      views: 22,
      favorites: 3,
      updatedAt: day(0),
      url: "https://www.leboncoin.fr",
    },
    {
      id: "l8",
      shopId: "s2",
      marketplace: "leboncoin",
      title: "Fauteuil velours vert",
      price: 120,
      status: "active",
      views: 41,
      favorites: 7,
      updatedAt: day(2),
      url: "https://www.leboncoin.fr",
    },
    {
      id: "l9",
      shopId: "s2",
      marketplace: "leboncoin",
      title: "Lot déco Halloween",
      price: 25,
      status: "reserved",
      views: 15,
      favorites: 2,
      updatedAt: day(1),
      url: "https://www.leboncoin.fr",
    },
    {
      id: "l10",
      shopId: "s2",
      marketplace: "leboncoin",
      title: "Console TV bois",
      price: 90,
      status: "active",
      views: 58,
      favorites: 5,
      updatedAt: day(6),
      url: "https://www.leboncoin.fr",
    },
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

function syncShopCounts(shops: Shop[], listings: Listing[]): Shop[] {
  return shops.map((s) => ({
    ...s,
    listingCount: listings.filter((l) => l.shopId === s.id).length,
  }))
}

export const store = {
  getShops(): Shop[] {
    const s = read<Shop[] | null>(KEYS.shops, null)
    const listings = store.getListings()
    if (s) return syncShopCounts(s, listings)
    const d = syncShopCounts(defaultShops(), listings)
    write(KEYS.shops, d)
    return d
  },
  setShops(shops: Shop[]) {
    write(KEYS.shops, shops)
  },
  getListings(shopId?: string): Listing[] {
    let list = read<Listing[] | null>(KEYS.listings, null)
    // Reseed if missing or empty (old localStorage had shops counts without listings)
    if (!list || !list.length) {
      list = defaultListings()
      write(KEYS.listings, list)
    }
    if (shopId) return list.filter((l) => l.shopId === shopId)
    return list
  },
  setListings(listings: Listing[]) {
    write(KEYS.listings, listings)
    const shops = read<Shop[] | null>(KEYS.shops, null) || defaultShops()
    write(KEYS.shops, syncShopCounts(shops, listings))
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
