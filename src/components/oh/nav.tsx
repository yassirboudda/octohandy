"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/lib/oh-i18n"
import { Octopus } from "./octopus"

export function OhNav() {
  const { t, lang, setLang } = useT()
  return (
    <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="relative z-30 border-b bg-background">
      <nav className="mx-auto max-w-6xl px-4 sm:px-6 h-14 sm:h-16 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 mr-auto" aria-label="OctoHandy">
          <Octopus still className="w-8 sm:w-9" label="" />
          <span className="font-heading text-lg sm:text-xl text-foreground">OctoHandy</span>
        </Link>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={lang}
          onValueChange={(v) => v && setLang(v as "en" | "fr")}
          aria-label="Language"
        >
          {(["en", "fr"] as const).map((l) => (
            <ToggleGroupItem key={l} value={l} className="text-xs font-semibold data-[state=on]:bg-butter data-[state=on]:text-foreground">
              {l.toUpperCase()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button asChild variant="ghost" className="hidden sm:inline-flex">
          <Link href="/sign-in">{t.nav.signIn}</Link>
        </Button>
        <Button asChild>
          <Link href="/sign-up">{t.nav.start}</Link>
        </Button>
      </nav>
    </motion.header>
  )
}
