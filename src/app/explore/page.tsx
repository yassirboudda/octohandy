"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Camera, ExternalLink, Search, X } from "lucide-react"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { BoxImg } from "@/components/oh/box"
import { ChatBar } from "@/components/oh/chat-bar"
import { FilterMenu } from "@/components/oh/filter-menu"
import { Octopus } from "@/components/oh/octopus"
import { OhShell } from "@/components/oh/shell"
import { money, useT } from "@/lib/oh-i18n"
import {
  COLORS, CONDITIONS, MARKETPLACES, MATERIALS, NO_FILTERS, PRICE_CAPS, mkName, mkSearchUrl, searchOffers,
  type Filters, type MarketplaceId, type Offer,
} from "@/lib/oh-data"
import { loadScreenMemories, type ScreenMemory } from "@/lib/screenpipe"

// The pile is shuffled once per visit; the server renders the plain order.
type Spot = { id: MarketplaceId; x: number; y: number; r: number; s: number }
const plain: Spot[] = MARKETPLACES.map((m) => ({ id: m.id, x: 0, y: 0, r: 0, s: 1 }))
let pile: Spot[] | null = null
const getPile = () => {
  if (!pile) {
    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    pile = [...MARKETPLACES]
      .sort(() => Math.random() - 0.5)
      .map((m) => ({ id: m.id, x: rand(-30, 30), y: rand(-14, 26), r: rand(-10, 10), s: rand(0.8, 1.05) }))
  }
  return pile
}
const noop = () => () => {}

export default function ExplorePage() {
  return (
    <OhShell>
      <Explore />
    </OhShell>
  )
}

function Explore() {
  const { t, lang } = useT()
  const spots = useSyncExternalStore(noop, getPile, () => plain)
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [openId, setOpenId] = useState<MarketplaceId | null>(null)
  const [screen, setScreen] = useState<{ live: boolean; memories: ScreenMemory[] } | null>(null)

  useEffect(() => {
    let alive = true
    loadScreenMemories().then((r) => alive && setScreen(r))
    return () => {
      alive = false
    }
  }, [])

  const results = useMemo(() => searchOffers(query, filters), [query, filters])
  const byMk = useMemo(() => {
    const m = new Map<MarketplaceId, Offer[]>()
    for (const o of results) m.set(o.marketplace, [...(m.get(o.marketplace) ?? []), o])
    return m
  }, [results])
  const searching = query.trim().length > 0 || filters !== NO_FILTERS

  const run = (q: string) => {
    setDraft(q)
    setQuery(q)
    setOpenId(null)
  }

  const toggle = <K extends "colors" | "materials" | "conditions">(k: K, v: Filters[K][number]) =>
    setFilters((f) => {
      const list = f[k] as string[]
      return { ...f, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] }
    })

  // Chat: a search-like message runs the search on the shelf right away.
  const onIntent = (text: string) => {
    let q = text
    let max: number | null = null
    const price = q.match(/(?:under|below|less than|moins de|sous|<)\s*€?\s*(\d+)\s*€?/i)
    if (price) {
      max = Number(price[1])
      q = q.replace(price[0], " ")
    }
    q = q
      .replace(/\b(find|search|look for|show me|trouve|cherche|chercher|montre|moi|des|de|du|le|la|les|un|une|me|for|the|a|size|taille|en|in|à|a)\b/gi, " ")
      .replace(/[,.!?]/g, " ")
      .replace(/\b\d{2}(\.\d)?\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    const f = max ? { ...NO_FILTERS, maxPrice: max } : NO_FILTERS
    setFilters(f)
    run(q)
    return t.chat.demoSearch(q || text, searchOffers(q, f).length)
  }

  const open = openId ? MARKETPLACES.find((m) => m.id === openId)! : null
  const openOffers = openId ? (byMk.get(openId) ?? []) : []

  return (
    <main className="pb-44">
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-4 sm:pt-8">
        <h1 className="sr-only">{t.explore.title}</h1>
        <form
          className="oh-search flex items-center gap-2 pl-4 pr-1.5 py-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            run(draft.trim())
          }}
          role="search"
        >
          <Search size={20} className="text-[var(--ink-soft)] shrink-0" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.explore.placeholder}
            aria-label={t.explore.placeholder}
            className="flex-1 min-w-0 bg-transparent outline-none text-base text-[var(--ink)] placeholder:text-[var(--ink-soft)] py-2"
          />
          {draft && (
            <button type="button" className="oh-icon-btn" aria-label={t.explore.clear} onClick={() => run("")}>
              <X size={18} />
            </button>
          )}
          <label className="oh-icon-btn cursor-pointer" title={t.explore.photo} aria-label={t.explore.photo}>
            <Camera size={19} />
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={() => {
                toast(t.explore.photoDemo)
                run("Louboutin So Kate")
              }}
            />
          </label>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterMenu label={t.explore.colour} options={COLORS.map((c) => ({ value: c, label: t.colors[c] }))} selected={filters.colors} onToggle={(v) => toggle("colors", v)} />
          <FilterMenu label={t.explore.material} options={MATERIALS.map((c) => ({ value: c, label: t.materials[c] }))} selected={filters.materials} onToggle={(v) => toggle("materials", v)} />
          <FilterMenu label={t.explore.condition} options={CONDITIONS.map((c) => ({ value: c, label: t.conditions[c] }))} selected={filters.conditions} onToggle={(v) => toggle("conditions", v)} />
          <FilterMenu
            single
            label={filters.maxPrice ? t.explore.upTo(filters.maxPrice) : t.explore.budget}
            options={PRICE_CAPS.map((p) => ({ value: p, label: t.explore.upTo(p) }))}
            selected={filters.maxPrice ? [filters.maxPrice] : []}
            onToggle={(v) => setFilters((f) => ({ ...f, maxPrice: f.maxPrice === v ? null : v }))}
          />
          {filters !== NO_FILTERS && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFilters(NO_FILTERS)}>
              {t.explore.clear}
            </Button>
          )}
        </div>

        {screen && screen.memories.length > 0 && (
          <div className="mt-5 flex items-center gap-2 overflow-x-auto oh-noscroll -mx-4 px-4 sm:mx-0 sm:px-0">
            <span className="text-sm text-[var(--ink-soft)] shrink-0">
              {t.explore.screen} <span className="opacity-70">({screen.live ? t.explore.screenLive : t.explore.screenDemo})</span>
            </span>
            {screen.memories.map((m) => (
              <button key={m.query} type="button" className="oh-hint shrink-0" onClick={() => run(m.query)}>
                {m.query} <span className="opacity-60">· {m.seenOn}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* The pile: one box per marketplace, scattered */}
      <section className="relative mx-auto max-w-6xl px-4 sm:px-6 mt-8 sm:mt-12 overflow-x-clip lg:overflow-visible">
        <p className="text-center text-sm text-[var(--ink-soft)] mb-2">{t.explore.tap}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-10 gap-y-6 sm:gap-y-4">
          {spots.map((s, i) => {
            const offers = byMk.get(s.id) ?? []
            const empty = searching && offers.length === 0
            const isOpen = openId === s.id
            return (
              <motion.button
                key={s.id}
                type="button"
                onClick={() => setOpenId(isOpen ? null : s.id)}
                aria-pressed={isOpen}
                aria-label={`${mkName(s.id)}: ${searching ? (offers.length ? t.explore.found(offers.length) : t.explore.none) : ""}`}
                className={cn("oh-pilebox relative mx-auto block w-full max-w-[250px]", empty && "oh-pilebox-empty")}
                style={{ x: s.x, y: s.y, rotate: s.r, scale: s.s }}
                initial={{ opacity: 0, y: s.y - 50 }}
                animate={{ opacity: 1, y: s.y }}
                transition={{ type: "spring", stiffness: 260, damping: 18, delay: i * 0.05 }}
                whileHover={{ y: s.y - 8, rotate: s.r * 0.5 }}
                whileTap={{ scale: s.s * 0.96 }}
              >
                <BoxImg name={isOpen ? `mk-${s.id}-open` : `mk-${s.id}`} width={300} className="w-full h-auto" preload={i < 3} alt="" />
                {searching && (
                  <span className={cn("oh-count", offers.length ? "" : "oh-count-zero")}>
                    {offers.length ? t.explore.found(offers.length) : t.explore.none}
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>
        <Octopus className="hidden lg:block absolute -left-24 bottom-0 w-44 pointer-events-none" label="" />
      </section>

      {/* What's inside the open box */}
      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              aria-label={t.explore.close}
              className="fixed inset-0 z-40 bg-[var(--ink)]/25 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpenId(null)}
            />
            <motion.aside
              role="dialog"
              aria-label={open.name}
              className="oh-drawer fixed z-50 bottom-0 inset-x-0 max-h-[82dvh] sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:max-h-none sm:w-[440px] overflow-y-auto"
              initial={{ y: "100%", x: 0 }}
              animate={{ y: 0, x: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 32 }}
            >
              <div className="sticky top-0 z-10 oh-drawer-head flex items-center gap-3 px-5 py-4">
                <BoxImg name={`mk-${open.id}-open`} width={80} className="w-16 h-auto" alt="" />
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold leading-tight">{open.name}</h2>
                  <p className="text-sm text-[var(--ink-soft)]">{openOffers.length ? t.explore.found(openOffers.length) : t.explore.none}</p>
                </div>
                <button type="button" className="oh-icon-btn ml-auto" onClick={() => setOpenId(null)} aria-label={t.explore.close}>
                  <X size={20} />
                </button>
              </div>
              <ul className="px-5 pb-8 space-y-3">
                {openOffers.length === 0 && <li className="py-10 text-center text-[var(--ink-soft)]">{t.explore.nothing}</li>}
                {openOffers.map((o) => (
                  <li key={o.id} className="oh-offer p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs uppercase tracking-wider text-[var(--ink-soft)]">{o.brand}</p>
                        <p className="font-medium text-[var(--ink)] leading-snug mt-0.5">{o.title}</p>
                        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                          <span className="oh-tag">{t.conditions[o.condition]}</span>
                          <span className="oh-tag">{t.colors[o.color]}</span>
                          {o.size && (
                            <span className="oh-tag">
                              {t.explore.size} {o.size}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-semibold">{money(o.price, lang)}</p>
                        {o.retail && o.retail > o.price ? <p className="text-xs text-[var(--ink-soft)] line-through">{t.explore.retail(o.retail)}</p> : null}
                      </div>
                    </div>
                    <Button asChild variant="outline" className="w-full mt-3">
                      <a href={mkSearchUrl(o.marketplace, `${o.brand} ${o.title}`)} target="_blank" rel="noreferrer">
                        {t.explore.view(open.name)} <ExternalLink />
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <ChatBar hints={t.chat.exploreHints} onIntent={onIntent} />
    </main>
  )
}
