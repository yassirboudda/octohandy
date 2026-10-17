"use client"

import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, MapPin, Star } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { BoxImg } from "@/components/oh/box"
import { ChatBar } from "@/components/oh/chat-bar"
import { Octopus } from "@/components/oh/octopus"
import { OhShell } from "@/components/oh/shell"
import { money, useT } from "@/lib/oh-i18n"
import { FAMILIES, PRODUCTS, PROFILE, familyQty, mkName, productQty, type Family, type Product } from "@/lib/oh-data"

export default function ProfilePage() {
  return (
    <OhShell>
      <Profile />
    </OhShell>
  )
}

function Profile() {
  const { t, lang } = useT()
  const [fam, setFam] = useState<Family | null>(null)
  const insideRef = useRef<HTMLDivElement>(null)
  const total = PRODUCTS.reduce((s, p) => s + productQty(p), 0)

  const openFamily = (f: Family) => {
    setFam((cur) => (cur === f ? null : f))
    setTimeout(() => insideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120)
  }

  // Chat: naming a family ("my shoes", "mes vestes") opens that box on the shelf.
  const onIntent = (text: string) => {
    const f = FAMILIES.find((x) => text.toLowerCase().includes(t.families[x].toLowerCase()))
    if (f) openFamily(f)
    return undefined
  }

  return (
    <main className="pb-44">
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-4 sm:pt-8">
        <div className="oh-card p-5 sm:p-8 grid gap-6 sm:grid-cols-[auto_1fr_auto] items-center relative overflow-hidden">
          <div className="oh-avatar" aria-hidden>
            {PROFILE.name
              .split(" ")
              .map((w) => w[0])
              .join("")}
          </div>
          <div className="min-w-0">
            <h1 className="oh-serif text-3xl sm:text-4xl leading-tight">{PROFILE.name}</h1>
            <p className="mt-1 text-[var(--ink-soft)] flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>@{PROFILE.handle}</span>
              <span className="inline-flex items-center gap-1">
                <Star size={15} className="fill-[var(--ink)] text-[var(--ink)]" /> {t.profile.rating(PROFILE.rating, PROFILE.reviews)}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin size={15} /> {PROFILE.city}
              </span>
            </p>
            <p className="mt-3 max-w-lg leading-relaxed">{t.profile.bio}</p>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-[var(--ink-soft)] mr-1">{t.profile.sellsOn}</span>
              {PROFILE.marketplaces.map((m) => (
                <span key={m} className="oh-tag">
                  {mkName(m)}
                </span>
              ))}
            </div>
          </div>
          <div className="flex sm:flex-col gap-6 sm:gap-3 sm:text-right">
            <Stat n={total} label={t.profile.items} />
            <Stat n={PROFILE.sold} label={t.profile.sold} />
            <Stat n={PROFILE.followers} label={t.profile.followers} />
          </div>
          <Button variant="outline" className="sm:col-start-2 sm:justify-self-start" onClick={() => toast(t.profile.editDemo)}>
            {t.profile.edit}
          </Button>
          <Octopus className="hidden md:block absolute right-6 -bottom-6 w-28 opacity-95 pointer-events-none" label="" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 mt-14">
        <div className="flex items-end justify-between gap-4">
          <h2 className="oh-serif oh-h3">{t.profile.shelf}</h2>
          <p className="text-sm text-[var(--ink-soft)]">{t.profile.shelfLead}</p>
        </div>

        <div className="oh-shelf mt-6 grid grid-cols-2 lg:grid-cols-3">
          {FAMILIES.map((f, i) => {
            const on = fam === f
            return (
              <div key={f} className="oh-shelf-cell">
                <motion.button
                  type="button"
                  onClick={() => openFamily(f)}
                  aria-pressed={on}
                  aria-label={`${t.families[f]}, ${t.profile.inStock(familyQty(f))}`}
                  className="relative block w-full max-w-[250px] mx-auto"
                  whileHover={{ y: -6 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <BoxImg name={on ? `fam-${f}-open` : `fam-${f}-${lang}`} width={260} className="w-full h-auto" preload={i < 3} alt="" />
                  <span className="oh-count">{familyQty(f)}</span>
                  {on && <span className="oh-open-name">{t.families[f]}</span>}
                </motion.button>
              </div>
            )
          })}
        </div>

        <div ref={insideRef} className="scroll-mt-24">
          <AnimatePresence mode="wait">
            {fam && (
              <motion.div
                key={fam}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="mt-10"
              >
                <h3 className="text-xl font-semibold">{t.families[fam]}</h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {PRODUCTS.filter((p) => p.family === fam).map((p) => (
                    <ProductBox key={p.id} p={p} money={(n) => money(n, lang)} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <ChatBar hints={t.chat.profileHints} onIntent={onIntent} />
    </main>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold leading-none tabular-nums">{n.toLocaleString()}</p>
      <p className="text-sm text-[var(--ink-soft)] mt-1">{label}</p>
    </div>
  )
}

// A product is a small box; its sizes or colours are the boxes inside it.
function ProductBox({ p, money }: { p: Product; money: (n: number) => string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const many = p.variants.length > 1
  return (
    <div className="oh-offer p-4">
      <button type="button" className="w-full flex items-center gap-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <BoxImg name={open ? "small-open" : "small"} width={84} className="w-16 h-auto shrink-0" alt="" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs uppercase tracking-wider text-[var(--ink-soft)]">{p.brand}</span>
          <span className="block font-medium leading-snug">{p.title}</span>
          <span className="block text-sm text-[var(--ink-soft)] mt-0.5">
            {t.profile.inStock(productQty(p))}
            {many ? ` · ${t.profile.variants(p.variants.length)}` : ""}
          </span>
        </span>
        <span className="text-right shrink-0">
          <span className="text-lg font-semibold block">{money(p.price)}</span>
          <ChevronDown size={18} className={cn("ml-auto mt-1 transition-transform text-[var(--ink-soft)]", open && "rotate-180")} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {p.variants.map((v, i) => (
              <li key={i} className="oh-variant mt-2 flex items-center gap-3 p-2.5">
                <BoxImg name="small" width={48} className="w-9 h-auto shrink-0" alt="" />
                <span className="font-medium min-w-14">{v.size ?? (v.color ? t.colors[v.color] : t.profile.any)}</span>
                <span className="text-sm text-[var(--ink-soft)]">×{v.qty}</span>
                <span className="ml-auto flex flex-wrap justify-end gap-1">
                  {v.listedOn.length ? (
                    v.listedOn.map((m) => (
                      <span key={m} className="oh-tag oh-tag-sm">
                        {mkName(m)}
                      </span>
                    ))
                  ) : (
                    <span className="oh-tag oh-tag-sm oh-tag-dashed">{t.profile.unlisted}</span>
                  )}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
