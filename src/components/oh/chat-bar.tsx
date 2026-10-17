"use client"

import { useAuth } from "@clerk/nextjs"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowUp, ChevronDown, ChevronUp, ImagePlus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { apiFetch } from "@/lib/api"
import { useT } from "@/lib/oh-i18n"
import { Octopus } from "./octopus"

type Msg = { id: string; role: "user" | "bot"; text: string }

/**
 * The one place users drive OctoHandy from. Messages go to the team's agent (/backend/v1/chat).
 * `onIntent` lets the page react right away (open boxes, filter the shelf) and gives a local
 * answer when the agent is unreachable.
 */
export function ChatBar({ hints, onIntent }: { hints: string[]; onIntent?: (text: string) => string | undefined }) {
  const { t } = useT()
  const { getToken } = useAuth()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [msgs, busy])

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setDraft("")
    setOpen(true)
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "user", text }])
    setBusy(true)
    const local = onIntent?.(text)
    let answer: string
    try {
      const token = await getToken().catch(() => null)
      const data = await apiFetch<{ content: string }>("/v1/chat", { method: "POST", token, body: { message: text, images: [] } })
      answer = data.content
    } catch {
      answer = local ?? t.chat.demo
    }
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "bot", text: answer }])
    setBusy(false)
  }

  return (
    <div className="oh-chat fixed inset-x-0 bottom-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-2xl px-3 sm:px-4 pb-3 sm:pb-5 pointer-events-auto">
        <AnimatePresence>
          {open && msgs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="oh-chat-log mb-2 max-h-[42vh] overflow-y-auto p-3 sm:p-4 space-y-2"
              aria-live="polite"
            >
              {msgs.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <p className={cn("oh-bubble", m.role === "user" ? "oh-bubble-me" : "oh-bubble-bot")}>{m.text}</p>
                </div>
              ))}
              {busy && (
                <div className="flex">
                  <p className="oh-bubble oh-bubble-bot oh-typing">{t.chat.thinking}</p>
                </div>
              )}
              <div ref={endRef} />
            </motion.div>
          )}
        </AnimatePresence>

        {msgs.length === 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 oh-noscroll">
            {hints.map((h) => (
              <button key={h} type="button" className="oh-hint" onClick={() => send(h)}>
                {h}
              </button>
            ))}
          </div>
        )}

        <form
          className="oh-chat-bar flex items-center gap-1.5 sm:gap-2 pl-2 pr-1.5 py-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          <Octopus still className="w-9 shrink-0" label="" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.chat.placeholder}
            aria-label={t.chat.placeholder}
            className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-soft)] py-2"
          />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={() => send(t.explore.photo)} />
          <button type="button" className="oh-icon-btn" onClick={() => fileRef.current?.click()} aria-label={t.chat.attach} title={t.chat.attach}>
            <ImagePlus size={18} />
          </button>
          {msgs.length > 0 && (
            <button type="button" className="oh-icon-btn" onClick={() => setOpen((v) => !v)} aria-label={open ? t.chat.hide : t.chat.open} title={open ? t.chat.hide : t.chat.open}>
              {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
          )}
          <button type="submit" className="oh-send" disabled={!draft.trim() || busy} aria-label={t.chat.send}>
            <ArrowUp size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}
