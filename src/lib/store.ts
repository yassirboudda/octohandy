"use client"

import type { UIMessage } from "ai"

export type Shop = {
  id: string
  marketplace: string
  displayName: string
  status: "connected" | "expired"
  listingCount: number
}

export type Listing = {
  id: string
  shopId: string
  marketplace: string
  title: string
  price: number
  status: "active" | "sold" | "reserved"
  imageUrl?: string
  url?: string
  views?: number
  favorites?: number
  updatedAt: string
  createdBy?: string
  creatorName?: string | null
}

export type StockItem = {
  id: string
  title: string
  sku?: string
  qty: number
  price?: number
  marketplace?: string
  ownerLabel: string
  createdBy?: string
  creatorName?: string | null
}

const EMPTY_CHAT: UIMessage[] = []
const chatCache = new Map<string, UIMessage[]>()

// v2: messages are AI SDK UIMessages (parts), v1 stored the old { content, images } shape.
export function chatKey(userId: string, orgId: string | null) {
  return `octohandy.chat.v2.${userId}.${orgId ?? "personal"}`
}

export const store = {
  getChat(userId: string, orgId: string | null): UIMessage[] {
    if (!userId || typeof window === "undefined") return EMPTY_CHAT
    const key = chatKey(userId, orgId)
    const cached = chatCache.get(key)
    if (cached) return cached
    try {
      const messages = JSON.parse(localStorage.getItem(key) || "[]") as UIMessage[]
      chatCache.set(key, messages)
      return messages
    } catch {
      chatCache.set(key, EMPTY_CHAT)
      return EMPTY_CHAT
    }
  },
  setChat(msgs: UIMessage[], userId: string, orgId: string | null) {
    if (typeof window === "undefined" || !userId) return
    const key = chatKey(userId, orgId)
    // shortcut: image parts are data URLs and would blow the ~5 MB localStorage quota, so history keeps text only; store images server-side if they must survive a reload.
    const textOnly = msgs.map((m) => ({ ...m, parts: m.parts.filter((p) => p.type !== "file") }))
    localStorage.setItem(key, JSON.stringify(textOnly))
    chatCache.set(key, textOnly)
  },
}
