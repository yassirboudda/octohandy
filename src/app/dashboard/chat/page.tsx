"use client"

import { useChat } from "@ai-sdk/react"
import { useAuth, useUser } from "@clerk/nextjs"
import { lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart } from "ai"
import { AnimatePresence, motion, MotionConfig } from "framer-motion"
import { ArrowUp, Check, ChevronRight, GraduationCap, ImagePlus, Play, Sparkles, Square, SquarePen } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import { Octopus } from "@/components/oh/octopus"
import { EmbeddedPage, RAISED } from "@/components/chat-card"
import { ConnectMarketplaceModal } from "@/components/connect-marketplace"
import { TeachWorkflowModal } from "@/components/teach-workflow"
import { cn } from "@/components/ui"
import { apiFetch } from "@/lib/api"
import { missionPrompt } from "@/lib/missions"
import { chatKey, store } from "@/lib/store"
import styles from "./chat.module.css"
import { EMBEDDED_PAGES, RunWorkflowCard } from "./tool-cards"

const VIDEO_URL = /https?:\/\/\S+\.mp4\b/g

// What a seller can start with, phrased as the action they want; the prompt is what gets sent.
const STARTERS = [
  { icon: GraduationCap, tint: "bg-butter", label: "Apprendre une tâche à OctoHandy", prompt: "Je veux qu'OctoHandy apprenne une tâche" },
  { icon: Play, tint: "bg-sky", label: "Lancer un de mes workflows", prompt: "Lance un de mes workflows" },
  { icon: Sparkles, tint: "bg-secondary", label: "Ce que je peux te demander", prompt: "Qu'est-ce que tu sais faire ?" },
]

const noopSubscribe = () => () => {}

// One tap opens the photo picker; the AI Elements menu item stays open after picking and steals Enter.
function AddPhotoButton() {
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton aria-label="Ajouter des photos" title="Ajouter des photos" className="rounded-full" onClick={() => attachments.openFileDialog()}>
      <ImagePlus className="size-[18px]" />
    </PromptInputButton>
  )
}

// Phone photos weigh several MB: Vercel rejects request bodies over 4.5 MB and the model doesn't need full size.
async function shrinkPhoto(part: FileUIPart, maxSide = 1600): Promise<FileUIPart> {
  if (!part.mediaType.startsWith("image/")) return part
  try {
    const img = new Image()
    img.src = part.url
    await img.decode()
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) return part
    ctx.fillStyle = "#fff" // JPEG has no transparency; white beats black behind transparent PNGs
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return { ...part, mediaType: "image/jpeg", url: canvas.toDataURL("image/jpeg", 0.85) }
  } catch {
    return part // formats the browser can't decode (e.g. HEIC) are sent as-is
  }
}

type RecordingOutput = { saved: true; title: string; steps: string[] } | { saved: false }
type ConnectOutput = { connected: true; shop: string } | { connected: false }

const note = "text-[13px] text-muted-foreground"
const interrupted = <p className={note}>Session interrompue. Redemande-moi si tu veux reprendre.</p>

export default function ChatPage() {
  const { user } = useUser()
  const { getToken, userId, orgId } = useAuth()
  const activeOrgId = orgId ?? null
  // localStorage only exists after hydration; reading it during SSR would mismatch the markup.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const storeUser = hydrated ? userId ?? "" : ""

  const request = useCallback(
    async <R,>(path: string, options: { method?: string; body?: unknown } = {}) => {
      const token = await getToken()
      if (!token) throw new Error("Session Clerk introuvable")
      return apiFetch<R>(path, { ...options, token })
    },
    [getToken]
  )

  // Default transport posts to /api/chat with the Clerk session cookie.
  const { messages, sendMessage, setMessages, addToolOutput, status, error, stop } = useChat({
    // A new id (user/org switch) makes useChat start a fresh Chat seeded with that workspace's history.
    id: chatKey(storeUser, activeOrgId),
    messages: store.getChat(storeUser, activeOrgId),
    // When the seller finishes the recording card, hand the result back to the assistant.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: ({ messages }) => store.setChat(messages, storeUser, activeOrgId),
    onError: (e) => toast.error(e.message || "Erreur chat"),
  })
  const busy = status === "submitted" || status === "streaming"

  // Onboarding links to ?mission=…&mp=…: only those fixed prompts are sent (never free text from a link), once.
  const sentInitial = useRef(false)
  useEffect(() => {
    if (!storeUser || sentInitial.current) return
    const q = missionPrompt(new URLSearchParams(window.location.search))
    if (!q) return
    sentInitial.current = true
    window.history.replaceState(null, "", window.location.pathname)
    void sendMessage({ text: q })
  }, [storeUser, sendMessage])

  // Cards call their success callback and then onClose; only the first outcome is sent to the assistant.
  const answered = useRef(new Set<string>())
  const finishTool = (tool: string, toolCallId: string, output: unknown) => {
    if (answered.current.has(toolCallId)) return
    answered.current.add(toolCallId)
    void addToolOutput({ tool, toolCallId, output })
  }

  // Interactive cards restored from history must not restart: a run card would launch a new run on every reload.
  const restored = useMemo(
    () => new Set(store.getChat(storeUser, activeOrgId).flatMap((m) => m.parts.flatMap((p) => ("toolCallId" in p ? [p.toolCallId] : [])))),
    [storeUser, activeOrgId]
  )

  const submit = async (message: PromptInputMessage) => {
    if (busy || (!message.text.trim() && !message.files.length)) return
    const files = await Promise.all(message.files.map((f) => shrinkPhoto(f)))
    void sendMessage({ text: message.text.trim() || "Voici une photo", files })
  }

  const last = messages.at(-1)
  const waiting = busy && !(last?.role === "assistant" && last.parts.some((p) => p.type !== "step-start"))

  const newConversation = () => {
    stop()
    setMessages([])
    store.setChat([], storeUser, activeOrgId)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-[calc(100dvh-8rem)] flex-col lg:h-[calc(100dvh-7rem)]">
        {messages.length > 0 && (
          <button
            type="button"
            onClick={newConversation}
            aria-label="Nouvelle conversation"
            title="Nouvelle conversation"
            className="absolute right-0 top-0 z-10 grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <SquarePen className="size-[18px]" />
          </button>
        )}

        <Conversation className="flex-1 min-h-0">
          <ConversationContent className="mx-auto w-full max-w-[44rem] gap-7 px-1 pb-44 pt-12">
            {!messages.length && (
              <div className="flex min-h-[calc(100dvh-22rem)] flex-col items-center justify-center text-center">
                <Octopus still className="size-16" />
                <h1 className="mt-5 font-heading text-[2.5rem] leading-[1.1] text-foreground">
                  {user?.firstName ? `Bonjour ${user.firstName}.` : "Bonjour."}
                </h1>
                <p className="mt-2 text-[17px] text-muted-foreground">Que veux-tu confier à OctoHandy ?</p>
                <ul className={cn("mt-9 w-full max-w-[26rem] overflow-hidden rounded-2xl bg-card text-left", RAISED)}>
                  {STARTERS.map(({ icon: Icon, tint, label, prompt }) => (
                    <li key={label} className="[&+li>button]:before:absolute [&+li>button]:before:left-[3.75rem] [&+li>button]:before:right-0 [&+li>button]:before:top-0 [&+li>button]:before:h-px [&+li>button]:before:bg-border">
                      <button
                        type="button"
                        onClick={() => void sendMessage({ text: prompt })}
                        className="relative flex w-full items-center gap-3.5 px-4 py-3 text-left text-[15px] text-foreground transition-colors hover:bg-secondary/60 focus-visible:bg-secondary focus-visible:outline-none"
                      >
                        <span className={cn("grid size-7 shrink-0 place-items-center rounded-[8px] text-foreground", tint)}>
                          <Icon className="size-4" />
                        </span>
                        <span className="flex-1">{label}</span>
                        <ChevronRight className="size-4 text-muted-foreground/70" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  style={{ transformOrigin: m.role === "user" ? "bottom right" : "bottom left" }}
                >
                  <Message from={m.role} className="max-w-full">
                    <MessageContent
                      className={cn(
                        m.role === "user"
                          ? "max-w-[78%] group-[.is-user]:rounded-[20px] group-[.is-user]:bg-primary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-[15px] group-[.is-user]:leading-[1.4] group-[.is-user]:text-primary-foreground"
                          : "w-full text-[15.5px] leading-[1.6]"
                      )}
                    >
                      {m.parts.map((part, i) => {
                        const key = `${m.id}-${i}`
                        switch (part.type) {
                          case "text": {
                            const videos = Array.from(new Set(part.text.match(VIDEO_URL) ?? []))
                            return (
                              <div key={key} className="max-w-[65ch] space-y-3">
                                <MessageResponse>{part.text.replace(VIDEO_URL, "").trim()}</MessageResponse>
                                {videos.map((src) => (
                                  <video key={src} src={src} controls preload="metadata" className={cn("w-full max-w-[34rem] rounded-2xl bg-black", RAISED)} />
                                ))}
                              </div>
                            )
                          }
                          case "file":
                            return part.mediaType.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={key} src={part.url} alt="" className="size-28 rounded-[14px] object-cover" />
                            ) : null
                          case "tool-showRecordingSession": {
                            if (part.state === "input-streaming") return null
                            if (part.state === "output-available") {
                              const out = part.output as RecordingOutput
                              return (
                                <p key={key} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                                  {out.saved && <Check className="size-3.5 text-success" />}
                                  {out.saved ? `Workflow « ${out.title} » enregistré` : "Enregistrement annulé"}
                                </p>
                              )
                            }
                            if (part.state !== "input-available") return null
                            if (restored.has(part.toolCallId)) return <div key={key}>{interrupted}</div>
                            return (
                              <div key={key} className="w-full">
                                <TeachWorkflowModal
                                  inline
                                  open
                                  request={request}
                                  marketplace={(part.input as { marketplace?: string }).marketplace}
                                  onSaved={(w) => finishTool("showRecordingSession", part.toolCallId, { saved: true, ...w })}
                                  onClose={() => finishTool("showRecordingSession", part.toolCallId, { saved: false })}
                                />
                              </div>
                            )
                          }
                          case "tool-runWorkflow": {
                            if (part.state === "output-available") return <p key={key} className={note}>Exécution du workflow terminée</p>
                            if (part.state !== "input-available") return null
                            if (restored.has(part.toolCallId)) return <div key={key}>{interrupted}</div>
                            return (
                              <div key={key} className="w-full">
                                <RunWorkflowCard
                                  workflowId={(part.input as { workflowId: string }).workflowId}
                                  onClose={() => finishTool("runWorkflow", part.toolCallId, { closed: true })}
                                />
                              </div>
                            )
                          }
                          case "tool-connectMarketplace": {
                            if (part.state === "output-available") {
                              const out = part.output as ConnectOutput
                              return (
                                <p key={key} className={cn(note, "inline-flex items-center gap-1.5")}>
                                  {out.connected && <Check className="size-3.5 text-success" />}
                                  {out.connected ? `${out.shop} connectée` : "Connexion annulée"}
                                </p>
                              )
                            }
                            if (part.state !== "input-available") return null
                            if (restored.has(part.toolCallId)) return <div key={key}>{interrupted}</div>
                            return (
                              <div key={key} className="w-full">
                                <ConnectMarketplaceModal
                                  inline
                                  open
                                  request={request}
                                  initialMarketplace={(part.input as { marketplace?: string }).marketplace?.toLowerCase() ?? null}
                                  onConnected={(shop) => finishTool("connectMarketplace", part.toolCallId, { connected: true, shop: shop.displayName })}
                                  onClose={() => finishTool("connectMarketplace", part.toolCallId, { connected: false })}
                                />
                              </div>
                            )
                          }
                          case "tool-askDesktopAgent":
                            return (
                              <Tool key={key} className={cn("mb-0 max-w-[34rem] rounded-2xl border-0 bg-card", RAISED)}>
                                <ToolHeader title="Bureau OctoHandy" type={part.type} state={part.state} />
                                <ToolContent>
                                  <ToolInput input={part.input} />
                                  <ToolOutput output={part.output} errorText={part.errorText} />
                                </ToolContent>
                              </Tool>
                            )
                          default: {
                            const embed = EMBEDDED_PAGES[part.type]
                            if (!embed || !("state" in part)) return null
                            if (part.state === "output-error") return <p key={key} className={note}>Impossible d&apos;afficher {embed.label} : {part.errorText}</p>
                            if (part.state !== "output-available") return <p key={key} className={cn("text-[13px]", styles.shimmer)}>J&apos;ouvre {embed.label}…</p>
                            return (
                              <EmbeddedPage key={key}>
                                <embed.Page />
                              </EmbeddedPage>
                            )
                          }
                        }
                      })}
                    </MessageContent>
                  </Message>
                </motion.div>
              ))}
            </AnimatePresence>

            {waiting && (
              <p className={cn("text-[15px]", styles.shimmer)} role="status">
                OctoHandy réfléchit…
              </p>
            )}
            {error && !busy && (
              <p className="text-[15px] text-muted-foreground" role="alert">
                OctoHandy n&apos;a pas pu répondre. Renvoie ton message pour réessayer.
              </p>
            )}
          </ConversationContent>
          <ConversationScrollButton className="bottom-36 bg-card/90 backdrop-blur" />
        </Conversation>

        {/* Content scrolls under the composer; the fade keeps the last line readable behind the glass. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent pb-1 pt-12">
          <div className="pointer-events-auto mx-auto w-full max-w-[44rem]">
            <PromptInput
              onSubmit={submit}
              accept="image/*"
              multiple
              maxFiles={4}
              className={cn(
                "rounded-[26px] bg-card/75 ring-1 ring-border backdrop-blur-2xl backdrop-saturate-150 transition-shadow focus-within:ring-2 focus-within:ring-foreground/15",
                RAISED,
                "[&_[data-slot=input-group]]:rounded-[26px] [&_[data-slot=input-group]]:!border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:!ring-0"
              )}
            >
              <PromptInputAttachments>{(file) => <PromptInputAttachment data={file} />}</PromptInputAttachments>
              <PromptInputBody>
                <PromptInputTextarea
                  placeholder="Écris à OctoHandy…"
                  className="min-h-12 px-5 pt-4 text-[15px] placeholder:text-muted-foreground/80"
                />
              </PromptInputBody>
              <PromptInputFooter className="px-3 pb-3">
                <PromptInputTools>
                  <AddPhotoButton />
                </PromptInputTools>
                {/* While streaming the button becomes Stop: Hermes turns can take minutes. */}
                <PromptInputSubmit
                  status={status}
                  disabled={status === "submitted"}
                  aria-label={status === "streaming" ? "Arrêter" : "Envoyer"}
                  className="size-8 rounded-full"
                  onClick={(e) => {
                    if (status !== "streaming") return
                    e.preventDefault()
                    void stop()
                  }}
                >
                  {status === "streaming" ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" strokeWidth={2.5} />}
                </PromptInputSubmit>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}
