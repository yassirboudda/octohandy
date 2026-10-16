"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Loader2, X } from "lucide-react"
import { forwardRef, useEffect } from "react"
import { twMerge } from "tailwind-merge"

export const cn = (...c: (string | false | null | undefined)[]) => twMerge(c.filter(Boolean).join(" "))

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "blue"
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-55 select-none"
const btnVariants: Record<BtnVariant, string> = {
  primary: "btn-primary text-white px-4 py-2.5",
  blue: "glass-button-primary text-white px-4 py-2.5 border border-white/20",
  secondary: "bg-white/85 border border-border hover:bg-white hover:border-black/15 px-4 py-2.5 text-foreground shadow-sm",
  ghost: "px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted/50",
  danger: "px-4 py-2.5 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200/70",
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; size?: "sm" | "md" }
>(function Button({ variant = "primary", loading, size = "md", className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(btnBase, btnVariants[variant], size === "sm" && "px-3 py-1.5 text-xs rounded-lg", className)}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
})

export function Card({ className, children, interactive, ...rest }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div className={cn("glass-card rounded-2xl", interactive && "interactive cursor-pointer", className)} {...rest}>
      {children}
    </div>
  )
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass-panel rounded-2xl", className)} {...rest}>
      {children}
    </div>
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
  green: "bg-emerald-50 text-emerald-700 border-emerald-200/70",
  red: "bg-red-50 text-red-700 border-red-200/70",
  amber: "bg-amber-50 text-amber-700 border-amber-200/70",
  blue: "bg-blue-50 text-blue-700 border-blue-200/70",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  teal: "bg-cyan-50 text-cyan-800 border-cyan-200/70",
}
export type Tone = keyof typeof tones

export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  )
}

export function StatusDot({ tone, live }: { tone: "green" | "red" | "amber" | "slate" | "blue"; live?: boolean }) {
  const color = { green: "#10b981", red: "#ef4444", amber: "#f59e0b", slate: "#94a3b8", blue: "#2563eb" }[tone]
  return <span className={cn("status-dot", live && "live")} style={{ background: color, color }} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-xl", className)} />
}

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
      <div className="w-14 h-14 rounded-2xl glass-panel flex items-center justify-center text-secondary mb-4">{icon}</div>
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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className={cn("modal-panel relative w-full rounded-t-3xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-white/95 backdrop-blur">
              <h3 className="font-semibold">{title}</h3>
              <button onClick={onClose} className="w-9 h-9 rounded-xl hover:bg-muted/60 flex items-center justify-center" aria-label="Fermer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0", checked ? "bg-[#0f172a]" : "bg-slate-300")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-caption mt-1">{hint}</span>}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn("glass-input w-full rounded-xl px-3.5 py-2.5 text-sm placeholder:text-slate-400", className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref
) {
  return <textarea ref={ref} className={cn("glass-input w-full rounded-xl px-3.5 py-2.5 text-sm placeholder:text-slate-400 resize-y min-h-24", className)} {...rest} />
})

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
    <div className="inline-flex p-1 rounded-xl bg-muted/60 border border-border gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join("")}`} className="absolute inset-0 bg-white rounded-lg shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 36 }} />
          )}
          <span className="relative">
            {o.label}
            {o.count !== undefined && <span className="ml-1.5 text-xs text-muted-foreground">{o.count}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

export function MarketplaceLogo({ marketplace, size = 36 }: { marketplace: string; size?: number }) {
  if (marketplace === "vinted") {
    return (
      <span className="rounded-xl flex items-center justify-center font-bold text-white shrink-0 shadow-sm" style={{ width: size, height: size, background: "#09b1ba", fontSize: size * 0.42 }}>
        V
      </span>
    )
  }
  if (marketplace === "leboncoin") {
    return (
      <span className="rounded-xl flex items-center justify-center font-bold text-white shrink-0 shadow-sm" style={{ width: size, height: size, background: "#ec5a13", fontSize: size * 0.36 }}>
        lbc
      </span>
    )
  }
  return (
    <span className="rounded-xl flex items-center justify-center font-bold text-white bg-slate-500 shrink-0" style={{ width: size, height: size }}>
      ?
    </span>
  )
}

export function FadeIn({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
