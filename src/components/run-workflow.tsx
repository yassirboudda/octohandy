"use client"

import { AlertTriangle, Check, ExternalLink, Loader2, MonitorSmartphone, Play, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge, Button, Segmented } from "@/components/ui"
import { ModalOrCard } from "@/components/chat-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

type Requester = <R>(path: string, options?: { method?: string; body?: unknown }) => Promise<R>

export type RunAction = {
  tool: string
  args: Record<string, unknown>
  preview: string
  needs_approval: boolean
  target_text?: string
  input_text?: string
  submit?: boolean
}
export type RunPlan = { summary: string; situation?: string; actions: RunAction[]; risks?: string[]; ask_user?: string; via?: string }
export type RunLog = {
  t: string
  tool: string
  result: string
  detail: string
  preview?: string
  searched?: string
  matched?: string | null
  confidence?: number | null
  coordinates?: { x: number; y: number } | null
  evidence?: string
  outcome?: string
}
export type WorkflowRun = {
  id: string
  workflowId: string
  status: "planning" | "awaiting_approval" | "executing" | "executed" | "rejected" | "failed"
  mode: string
  context: { frames: number; windows: string[] } | null
  plan: RunPlan | null
  log: RunLog[]
  error: string | null
  createdAt: string
  updatedAt: string
}

export function workflowToolLabel(tool: string) {
  return ({
    list_unread_messages: "Lister les messages non lus",
    read_thread: "Lire une conversation",
    send_message: "Envoyer un message",
    list_favorites: "Consulter les favoris",
    list_offers: "Consulter les offres",
    send_offer: "Envoyer une offre",
    get_listing: "Consulter une annonce",
    update_price: "Modifier le prix",
    republish_listing: "Remettre une annonce en ligne",
    list_notifications: "Consulter les notifications",
    wait_for_event: "Attendre un événement",
    notify_seller: "Alerter le vendeur",
  } as Record<string, string>)[tool] ?? tool.replace(/_/g, " ")
}

export function workflowSourceLabel(source: string) {
  return ({ hermes: "Hermes", nebius: "Nebius", fallback: "mode de secours", mock: "simulation" } as Record<string, string>)[source] ?? source
}

export function workflowConfidenceLabel(confidence: string) {
  return ({ high: "élevée", medium: "moyenne", low: "faible" } as Record<string, string>)[confidence] ?? confidence
}

function resultLabel(result: string) {
  return ({
    assisted: "assisté",
    clicked: "cliqué",
    skipped: "ignoré",
    failed: "échec",
    partial: "partiel",
  } as Record<string, string>)[result] ?? result
}

export function RunWorkflowModal({
  workflow,
  onClose,
  request,
  inline = false,
}: {
  workflow: { id: string; title: string; marketplace: string } | null
  onClose: () => void
  request: Requester
  /** Render as a card in the chat instead of a modal. */
  inline?: boolean
}) {
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<"assisted" | "auto_click">("assisted")

  useEffect(() => {
    if (!workflow) return
    let cancelled = false
    request<{ run: WorkflowRun }>(`/v1/workflows/${workflow.id}/run`, { method: "POST" })
      .then(({ run: next }) => {
        if (cancelled) return
        setRun(next)
        setSelected((next.plan?.actions ?? []).map((_, i) => i))
      })
      .catch((cause: unknown) => {
        if (!cancelled) toast.error(cause instanceof Error ? cause.message : "Hermes n'a pas pu préparer le plan")
      })
    return () => {
      cancelled = true
    }
  }, [workflow, request])

  const workflowId = workflow?.id
  const runId = run?.id
  const runStatus = run?.status

  useEffect(() => {
    if (!workflowId || !runId || runStatus !== "executing") return
    let cancelled = false
    const timer = window.setInterval(() => {
      void request<{ runs: WorkflowRun[] }>(`/v1/workflows/runs?workflow_id=${encodeURIComponent(workflowId)}`)
        .then(({ runs }) => {
          const latest = runs.find((item) => item.id === runId)
          if (!cancelled && latest) setRun(latest)
        })
        .catch(() => undefined)
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [workflowId, runId, runStatus, request])

  const approve = async () => {
    if (!run) return
    setBusy(true)
    try {
      let desktop: { url: string } | null = null
      try {
        desktop = await request<{ url: string }>("/v1/desktop/sessions", {
          method: "POST",
          body: { marketplace: workflow?.marketplace, purpose: "browse" },
        })
      } catch (cause) {
        if (mode === "auto_click") throw cause
        toast.warning("Le bureau distant est indisponible ; l'exécution restera assistée.")
      }
      const { run: next } = await request<{ run: WorkflowRun }>(`/v1/workflows/runs/${run.id}/approve`, {
        method: "POST",
        body: { approved_indexes: selected, mode },
      })
      setRun(next)
      setDesktopUrl(desktop?.url ?? null)
      toast.success(mode === "auto_click" ? "Actions approuvées, exécution démarrée sur le bureau." : "Plan exécuté en mode assisté")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Exécution impossible")
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (run && run.status === "awaiting_approval") {
      await request(`/v1/workflows/runs/${run.id}/reject`, { method: "POST" }).catch(() => undefined)
    }
    if (run?.status !== "executing") {
      await request("/v1/desktop/release", { method: "POST" }).catch(() => undefined)
    }
    onClose()
  }

  const close = async () => {
    await request("/v1/desktop/release", { method: "POST" }).catch(() => undefined)
    onClose()
  }

  const plan = run?.plan

  return (
    <ModalOrCard inline={inline} open={!!workflow} onClose={() => void reject()} title={workflow ? `Lancer · ${workflow.title}` : "Lancer"}>
      {!run && (
        <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          Hermes regarde ton bureau (Screenpipe) et prépare le plan…
        </div>
      )}

      {run && plan && run.status === "awaiting_approval" && (
        <div className="space-y-4">
          <div>
            <p className="font-medium">{plan.summary}</p>
            {plan.situation && <p className="text-sm text-muted-foreground mt-1">{plan.situation}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              {run.context?.frames ?? 0} écrans analysés {plan.via && <Badge tone="slate">source : {workflowSourceLabel(plan.via)}</Badge>}
            </p>
          </div>
          {plan.ask_user && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle />
              <AlertDescription className="text-amber-900">{plan.ask_user}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-1.5">
            <span className="text-sm font-medium leading-none">Mode d&apos;exécution</span>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "assisted", label: "Assistance, sans clic automatique" },
                { value: "auto_click", label: "Clics après validation" },
              ]}
            />
          </div>
          <p className="text-xs text-muted-foreground">Seules les actions cochées seront exécutées, après ton approbation.</p>
          <ul className="space-y-2">
            {plan.actions.map((action, index) => (
              <li key={`${action.tool}-${index}`} className="rounded-lg border p-3 flex gap-3 items-start">
                <Checkbox
                  className="mt-0.5"
                  checked={selected.includes(index)}
                  onCheckedChange={(checked) => setSelected(checked === true ? [...selected, index] : selected.filter((i) => i !== index))}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="blue">{workflowToolLabel(action.tool)}</Badge>
                    {action.needs_approval && <Badge tone="amber">approbation requise</Badge>}
                    {!!Object.keys(action.args).length && (
                      <span className="text-xs text-muted-foreground truncate">{JSON.stringify(action.args)}</span>
                    )}
                  </div>
                  {action.preview && <p className="mt-2 text-sm whitespace-pre-wrap rounded-md bg-muted p-2">{action.preview}</p>}
                  {action.target_text && <p className="mt-1 text-xs text-muted-foreground">Cible à l&apos;écran : {action.target_text}</p>}
                  {action.input_text && <p className="mt-1 text-xs text-muted-foreground">Texte à saisir : {action.input_text}</p>}
                </div>
              </li>
            ))}
          </ul>
          {!!plan.risks?.length && (
            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
              {plan.risks.map((risk) => <li key={risk}>{risk}</li>)}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => void reject()}>
              <X className="w-4 h-4" /> Refuser
            </Button>
            <Button size="sm" loading={busy} disabled={!selected.length} onClick={() => void approve()}>
              <Check className="w-4 h-4" /> Approuver et exécuter ({selected.length})
            </Button>
          </div>
        </div>
      )}

      {run && (run.status === "executing" || run.status === "executed" || run.status === "failed") && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {run.status === "executing"
              ? "Exécution en cours sur le bureau. Le journal se met à jour automatiquement."
              : run.status === "failed"
                ? run.error ?? "L'exécution a échoué. Consulte le journal ci-dessous."
                : run.mode === "auto_click"
                  ? "Le bureau a exécuté les actions approuvées. Vérifie les résultats et les éléments reconnus à l'écran."
                  : "Mode assisté : les messages approuvés sont préparés dans le presse-papiers. Vérifie-les et envoie-les depuis le bureau."}
          </p>
          <ol className="space-y-2 text-sm max-h-96 overflow-y-auto">
            {run.log.map((entry, index) => (
              <li key={`${entry.tool}-${index}`} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="blue">{workflowToolLabel(entry.tool)}</Badge>
                  <Badge tone={entry.result === "assisted" || entry.result === "clicked" ? "teal" : entry.result === "skipped" ? "slate" : "amber"}>{resultLabel(entry.result)}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(entry.t).toLocaleTimeString("fr-FR")}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{entry.detail}</p>
                {entry.searched && <p className="text-xs mt-1">Cible recherchée : {entry.searched}</p>}
                {entry.matched && (
                  <p className="text-xs mt-1">
                    Élément reconnu : {entry.matched}
                    {entry.confidence != null ? ` · confiance ${Math.round(entry.confidence)} %` : ""}
                    {entry.coordinates ? ` · position ${entry.coordinates.x}, ${entry.coordinates.y}` : ""}
                  </p>
                )}
                {entry.evidence && <p className="text-xs text-muted-foreground mt-1">Écran après action : {entry.evidence}</p>}
              </li>
            ))}
          </ol>
          {desktopUrl && (
            <div className="rounded-lg overflow-hidden border bg-black aspect-video">
              <iframe src={desktopUrl} title="Bureau distant OctoHandy" className="w-full h-full" allow="clipboard-read; clipboard-write" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            {desktopUrl && (
              <a href={desktopUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLink className="w-4 h-4" /> Plein écran
              </a>
            )}
            <Button size="sm" onClick={() => void close()}>
              <MonitorSmartphone className="w-4 h-4" /> Terminer
            </Button>
          </div>
        </div>
      )}
      {run && run.status === "rejected" && (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Play className="w-4 h-4" /> Exécution refusée.</p>
      )}
    </ModalOrCard>
  )
}
