"use client"

import { motion, type Variants } from "framer-motion"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { useLayoutEffect, useRef } from "react"
import { BoxImg } from "@/components/oh/box"
import { Octopus } from "@/components/oh/octopus"
import { OhShell } from "@/components/oh/shell"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/oh-i18n"
import { FAMILIES } from "@/lib/oh-data"

gsap.registerPlugin(ScrollTrigger)

const EASE = [0.16, 1, 0.3, 1] as const
// Hero copy rises in line by line; gsap keeps the box pile and scroll reveals.
const hero: Variants = { show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } }
const rise: Variants = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } } }
const lift = { whileHover: { y: -2 }, whileTap: { scale: 0.97 }, transition: { type: "spring", stiffness: 400, damping: 22 } } as const
// Scroll reveals: each block rises once when it enters the viewport; groups stagger their children.
const inView = { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "-80px" } } as const
const group: Variants = { show: { transition: { staggerChildren: 0.12 } } }
const pop: Variants = { hidden: { scale: 0, rotate: -20 }, show: { scale: 1, rotate: 0, transition: { type: "spring", stiffness: 420, damping: 14, delay: 0.25 } } }
const drop: Variants = {
  hidden: { opacity: 0, y: -60, rotate: -6 },
  show: { opacity: 1, y: 0, rotate: 0, transition: { type: "spring", stiffness: 260, damping: 16 } },
}

// Scattered pile around the octopus: [box, left %, bottom %, width %, rotation, z, scroll speed]
const PILE: [string, number, number, number, number, number, number][] = [
  ["mk-farfetch", 5, 36, 12, -9, 1, 1.4],
  ["mk-vinted-open", 15, 17, 15, 6, 2, 0.9],
  ["mk-vinted", 1, 0, 20, -3, 4, 0.5],
  ["mk-ebay-open", 22, -3, 19, 3, 5, 0.3],
  ["mk-zara", 68, 38, 12, 8, 1, 1.5],
  ["mk-zalando", 79, 19, 17, -6, 2, 1.0],
  ["mk-amazon", 62, 1, 15, -4, 5, 0.4],
  ["mk-ebay", 78, -2, 18, 4, 4, 0.6],
]

export default function Home() {
  return (
    <OhShell>
      <HomeContent />
    </OhShell>
  )
}

function HomeContent() {
  const { t, lang } = useT()
  const stage = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!stage.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const ctx = gsap.context(() => {
      const boxes = gsap.utils.toArray<HTMLElement>(".oh-pile-box")
      gsap.from(boxes, { y: -140, opacity: 0, rotation: () => gsap.utils.random(-25, 25), duration: 1.1, ease: "bounce.out", stagger: 0.07, delay: 0.15 })
      gsap.from(".oh-hero-octo", { y: 40, opacity: 0, duration: 1, ease: "power3.out" })
      boxes.forEach((el) => {
        gsap.to(el, { yPercent: -60 * Number(el.dataset.speed || 1), ease: "none", scrollTrigger: { trigger: stage.current, start: "top 35%", end: "bottom top", scrub: true } })
      })
    }, stage.current.parentElement ?? undefined)
    return () => ctx.revert()
  }, [])

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden pb-14 sm:pb-20">
        <motion.div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10 text-center" variants={hero} initial="hidden" animate="show">
          <motion.p variants={rise} className="oh-kicker">{t.home.kicker}</motion.p>
          <h1 className="oh-serif oh-display mt-4">
            <motion.span variants={rise} className="block">{t.home.title1}</motion.span>
            <motion.em variants={rise} className="block not-italic text-[var(--ink-soft)]">{t.home.title2}</motion.em>
          </h1>
          <motion.p variants={rise} className="mx-auto mt-5 max-w-xl text-[17px] sm:text-lg leading-relaxed text-[var(--ink-soft)]">{t.home.lead}</motion.p>
          <motion.div variants={rise} className="mt-8 flex flex-wrap justify-center gap-3">
            <motion.div {...lift}>
              <Button asChild size="lg">
                <Link href="/sign-up">
                  {t.home.ctaExplore} <ArrowRight />
                </Link>
              </Button>
            </motion.div>
            <motion.div {...lift}>
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-in">{t.home.ctaShelf}</Link>
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* sky only as the backdrop behind the octopus art */}
        <div className="mx-auto mt-10 max-w-6xl px-4 sm:px-6">
        <div className="oh-bg-sky rounded-xl border overflow-hidden">
        <div ref={stage} className="relative mx-auto w-full max-w-[1100px] aspect-[11/6.4] sm:aspect-[11/5.2]">
          <div className="oh-hero-octo absolute left-1/2 -translate-x-1/2 bottom-[8%] w-[46%] sm:w-[38%] z-[3]">
            <Octopus label="OctoHandy" className="w-full" />
          </div>
          {PILE.map(([name, left, bottom, width, rot, z, speed]) => (
            <div
              key={name}
              className="oh-pile-box absolute"
              data-speed={speed}
              style={{ left: `${left}%`, bottom: `${bottom}%`, width: `${width}%`, zIndex: z, rotate: `${rot}deg` }}
            >
              <BoxImg name={name} width={320} className="w-full h-auto" preload={z >= 4} alt="" />
            </div>
          ))}
          <div className="absolute inset-x-[6%] bottom-[-2%] h-[10%] rounded-[50%] bg-[var(--ink)] opacity-[0.07] blur-xl" aria-hidden />
        </div>
        </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative border-t">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <motion.h2 {...inView} variants={rise} className="oh-serif oh-h2 text-center">{t.home.howTitle}</motion.h2>
          <motion.ol {...inView} variants={group} className="mt-12 sm:mt-16 grid gap-6 sm:grid-cols-3">
            {t.home.how.map((s, i) => (
              <motion.li key={s.t} variants={rise} whileHover={{ y: -4 }} className="oh-card p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <motion.span variants={pop} className="oh-step">{i + 1}</motion.span>
                  <BoxImg name={["mk-vinted", "mk-ebay-open", "mk-vinted-open"][i]} width={120} className="w-24 h-auto -my-3" alt="" />
                </div>
                <h3 className="text-lg font-semibold mt-5">{s.t}</h3>
                <p className="mt-2 text-[var(--ink-soft)] leading-relaxed">{s.d}</p>
              </motion.li>
            ))}
          </motion.ol>
        </div>
      </section>

      {/* Ask */}
      <section className="bg-muted border-y relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28 grid gap-12 lg:grid-cols-[1fr_1.1fr] items-center">
          <motion.div {...inView} variants={group}>
            <motion.h2 variants={rise} className="oh-serif oh-h2">{t.home.askTitle}</motion.h2>
            <motion.p variants={rise} className="mt-4 text-lg text-[var(--ink-soft)] max-w-md leading-relaxed">{t.home.askLead}</motion.p>
            {/* The octopus pops up from below, then keeps its own CSS float. */}
            <motion.div variants={{ hidden: { opacity: 0, y: 40, scale: 0.85 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 200, damping: 14 } } }} className="w-40 sm:w-52 mt-8">
              <Octopus className="w-full" label="" />
            </motion.div>
          </motion.div>
          <motion.div {...inView} variants={rise} className="oh-card p-5 sm:p-7 space-y-3">
            {/* The demo conversation plays out once, message by message, when scrolled into view. */}
            {[t.home.askUser, t.home.askBot, t.home.askUser2, t.home.askBot2].map((text, i) => (
              <motion.p
                key={i}
                className={i % 2 ? "oh-bubble oh-bubble-bot" : "oh-bubble oh-bubble-me ml-auto"}
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.45, delay: 0.25 + i * 0.55, ease: EASE }}
                style={{ transformOrigin: i % 2 ? "left bottom" : "right bottom" }}
              >
                {text}
              </motion.p>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Seller shelf */}
      <section className="oh-bg-ink relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <motion.div {...inView} variants={group} className="max-w-xl">
            <motion.h2 variants={rise} className="oh-serif oh-h2 text-[var(--butter)]">{t.home.sellTitle}</motion.h2>
            <motion.p variants={rise} className="mt-4 text-lg text-[var(--butter)]/75 leading-relaxed">{t.home.sellLead}</motion.p>
            <motion.div {...lift} className="mt-8 inline-block">
              <Button asChild size="lg" className="bg-butter text-foreground hover:bg-butter/90">
                <Link href="/sign-up">
                  {t.home.ctaExplore} <ArrowRight />
                </Link>
              </Button>
            </motion.div>
          </motion.div>
          <div className="mt-14">
            {/* Family boxes drop onto the shelf one after another. */}
            <motion.div {...inView} variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2 items-end">
              {FAMILIES.map((f) => (
                <motion.div key={f} variants={drop} whileHover={{ y: -8, rotate: -2 }}>
                  <BoxImg name={`fam-${f}-${lang}`} width={220} className="w-full h-auto" alt={t.families[f]} />
                </motion.div>
              ))}
            </motion.div>
            <div className="oh-plank" aria-hidden />
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 flex flex-wrap items-center gap-3 justify-between text-sm text-[var(--ink-soft)]">
          <span className="flex items-center gap-2">
            <Octopus still className="w-7" label="" />
            <span className="font-heading text-base text-foreground">OctoHandy</span>
          </span>
          <span>{t.home.footer}</span>
        </div>
      </footer>
    </main>
  )
}
