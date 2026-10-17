"use client"

import { MotionConfig } from "framer-motion"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { LangProvider } from "@/lib/oh-i18n"
import { OhNav } from "./nav"

export function OhShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <LangProvider>
      {/* Honour the OS "reduce motion" setting for every framer animation on public pages. */}
      <MotionConfig reducedMotion="user">
        <div className={cn("oh min-h-dvh bg-background", className)}>
          <OhNav />
          {children}
        </div>
      </MotionConfig>
    </LangProvider>
  )
}
