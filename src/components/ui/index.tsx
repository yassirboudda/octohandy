"use client"

// House kit: the names and props pages already use, built on shadcn/ui primitives in this folder.
import { Loader2 } from "lucide-react"
import { siEbay, siEtsy, siFacebook, siVinted, type SimpleIcon } from "simple-icons"
import { cn } from "@/lib/utils"
import { Button as ShadButton } from "./button"
import { Badge as ShadBadge } from "./badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog"
import { Input as ShadInput } from "./input"
import { Textarea as ShadTextarea } from "./textarea"
import { Skeleton as ShadSkeleton } from "./skeleton"
import { Tabs, TabsList, TabsTrigger } from "./tabs"

export { cn }

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "blue"
const btnVariants = {
  primary: "default",
  blue: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
} as const

export function Button({
  variant = "primary",
  loading,
  size = "md",
  disabled,
  children,
  ...rest
}: React.ComponentProps<"button"> & { variant?: BtnVariant; loading?: boolean; size?: "sm" | "md"; asChild?: boolean }) {
  return (
    <ShadButton variant={btnVariants[variant]} size={size === "sm" ? "sm" : "default"} disabled={disabled || loading} {...rest}>
      {/* asChild (Slot) needs a single child, so the spinner only renders when loading */}
      {loading ? (
        <>
          <Loader2 className="animate-spin" />
          {children}
        </>
      ) : (
        children
      )}
    </ShadButton>
  )
}

export function Card({ className, interactive, ...rest }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground rounded-xl border shadow-xs",
        interactive && "cursor-pointer transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-sm",
        className
      )}
      {...rest}
    />
  )
}

export function PageHeader({
  label,
  title,
  subtitle,
  actions,
}: {
  label?: string
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div className="min-w-0">
        {label && <p className="text-label mb-1.5">{label}</p>}
        <h1 className="text-title">{title}</h1>
        {subtitle && <p className="text-body-muted mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

const tones = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  red: "bg-red-50 text-red-700 border-red-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  blue: "bg-butter text-foreground border-transparent",
  slate: "bg-muted text-muted-foreground border-transparent",
  teal: "bg-sky/50 text-foreground border-transparent",
}

export function Badge({ tone = "slate", children, className }: { tone?: keyof typeof tones; children: React.ReactNode; className?: string }) {
  return (
    <ShadBadge variant="outline" className={cn(tones[tone], className)}>
      {children}
    </ShadBadge>
  )
}

export function StatusDot({ tone, live }: { tone: "green" | "red" | "amber" | "slate" | "blue"; live?: boolean }) {
  const color = { green: "#10b981", red: "#ef4444", amber: "#f59e0b", slate: "#94a3b8", blue: "#2563eb" }[tone]
  return <span className={cn("status-dot", live && "live")} style={{ background: color, color }} />
}

export const Skeleton = ShadSkeleton

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode
  title: string
  text?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12">
      <div className="size-14 rounded-xl bg-sky/60 flex items-center justify-center mb-4">{icon}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="text-caption mt-1 max-w-sm">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[92dvh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium leading-none">{label}</span>
      {children}
      {hint && <span className="text-caption">{hint}</span>}
    </label>
  )
}

export const Input = ShadInput
export const Textarea = ShadTextarea

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)}>
      <TabsList>
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value}>
            {o.label}
            {o.count !== undefined && <span className="text-xs text-muted-foreground">{o.count}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

// Brand marks from simpleicons.org; marketplaces it doesn't cover fall back to a coloured initial.
const BRAND_ICONS: Record<string, SimpleIcon> = { vinted: siVinted, ebay: siEbay, etsy: siEtsy, facebook_marketplace: siFacebook }

export function MarketplaceLogo({ marketplace, size = 36 }: { marketplace: string; size?: number }) {
  const icon = BRAND_ICONS[marketplace]
  if (icon) {
    return (
      <span aria-hidden className="rounded-md flex items-center justify-center shrink-0" style={{ width: size, height: size, background: `#${icon.hex}` }}>
        <svg viewBox="0 0 24 24" fill="#fff" style={{ width: size * 0.56, height: size * 0.56 }}>
          <path d={icon.path} />
        </svg>
      </span>
    )
  }
  const palette = ["#5b57d9", "#d44f82", "#27836e", "#be7425", "#3976b7", "#8056a6", "#3e818e", "#a1473e"]
  const hash = [...marketplace].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7)
  const initial = marketplace.replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase() || "M"
  const background = palette[hash % palette.length]
  return (
    <span aria-hidden className="rounded-md flex items-center justify-center font-bold text-white shrink-0" style={{ width: size, height: size, background, fontSize: size * 0.42 }}>
      {initial}
    </span>
  )
}
