"use client"

import { X } from "lucide-react"
import { cn, Modal } from "@/components/ui"

// Two-layer shadow: a tight contact shadow plus a wide soft one, so surfaces sit on the page instead of floating.
export const RAISED = "shadow-[0_1px_2px_rgba(67,48,46,0.06),0_12px_32px_-12px_rgba(67,48,46,0.18)]"

/** Same content as a modal on dashboard pages, or as a card inside the chat conversation. */
export function ModalOrCard({
  inline,
  open,
  onClose,
  title,
  children,
}: {
  inline?: boolean
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!inline) {
    return (
      <Modal open={open} onClose={onClose} title={title} wide>
        {children}
      </Modal>
    )
  }
  return (
    <section aria-label={title} className={cn("w-full space-y-4 rounded-[20px] bg-card p-5", RAISED)}>
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="-m-1.5 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-4" />
        </button>
      </header>
      {children}
    </section>
  )
}

/** A whole dashboard page shown inside the chat: its header shrinks to a card title, its actions stay. */
export function EmbeddedPage({ children }: { children: React.ReactNode }) {
  return (
    <section
      className={cn(
        "w-full rounded-[20px] bg-card p-5",
        RAISED,
        "[&_.text-label]:hidden [&_.text-title]:font-sans [&_.text-title]:text-[15px] [&_.text-title]:font-semibold [&_.text-title]:leading-tight [&_.text-body-muted]:text-[13px]",
        "[&>div>div:first-child]:mb-4"
      )}
    >
      {children}
    </section>
  )
}
