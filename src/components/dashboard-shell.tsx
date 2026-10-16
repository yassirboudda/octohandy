"use client"

import { useClerk, useUser } from "@clerk/nextjs"
import {
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  Store,
  Workflow,
  X,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { cn } from "./ui"

const nav = [
  { href: "/dashboard", label: "Accueil", icon: LayoutDashboard },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquareText },
  { href: "/dashboard/shops", label: "Boutique", icon: Store },
  { href: "/dashboard/stock", label: "Stock", icon: Package },
  { href: "/dashboard/workflows", label: "Workflows", icon: Workflow },
]

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useUser()
  const { signOut } = useClerk()
  const [drawer, setDrawer] = useState(false)
  const active = (href: string) => (href === "/dashboard" ? pathname === href : pathname.startsWith(href))

  useEffect(() => setDrawer(false), [pathname])

  const linkClass = (href: string) =>
    cn(
      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
      active(href) ? "text-foreground bg-muted/60" : "text-muted-foreground hover:text-foreground hover:bg-muted/35"
    )

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-white/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <button className="lg:hidden w-9 h-9 rounded-xl hover:bg-muted/50 flex items-center justify-center" onClick={() => setDrawer(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/dashboard" className="font-bold tracking-tight text-lg">
            Stockflow
          </Link>
          <nav className="hidden lg:flex items-center gap-1 ml-4">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={linkClass(n.href)}>
                <n.icon className="w-4 h-4" />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[160px]">
              {user?.primaryEmailAddress?.emailAddress}
            </span>
            <button
              onClick={() => signOut({ redirectUrl: "/" })}
              className="w-9 h-9 rounded-xl hover:bg-muted/50 flex items-center justify-center text-muted-foreground"
              aria-label="Déconnexion"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold">Menu</p>
              <button onClick={() => setDrawer(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className={cn(linkClass(n.href), "w-full justify-start")}>
                  <n.icon className="w-4 h-4" />
                  {n.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 pb-24 lg:pb-8">{children}</main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/70 bg-white/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 gap-1 px-2 py-2">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] font-medium",
                active(n.href) ? "text-secondary bg-muted/50" : "text-muted-foreground"
              )}
            >
              <n.icon className="w-4 h-4" />
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
