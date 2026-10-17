"use client"

import { GraduationCap, Pause, Play, Rocket, Workflow } from "lucide-react"
import { useState } from "react"
import { Badge, Button, Card, PageHeader } from "@/components/ui"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { RunWorkflowModal } from "@/components/run-workflow"
import { TeachWorkflowModal } from "@/components/teach-workflow"
import { useWorkspaceResource } from "@/lib/use-workspace-resource"

type Flow = {
  id: string
  marketplace: string
  title: string
  steps: string[]
  tone: "teal" | "amber" | "blue" | "slate"
  enabled: boolean
  intent: { goal?: string; success_criteria?: string } | null
  guardrails: string[]
}

export default function WorkflowsPage() {
  const { data, error, isLoading, request, mutate, orgId } = useWorkspaceResource<{ workflows: Flow[] }>("/v1/workflows")
  const [teachOpen, setTeachOpen] = useState(false)
  const [running, setRunning] = useState<Flow | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const workflows = data?.workflows ?? []

  const toggle = async (flow: Flow) => {
    setSaving(flow.id)
    try {
      await request(`/v1/workflows/${flow.id}`, { method: "PATCH", body: { enabled: !flow.enabled } })
      await mutate()
    } catch (cause) {
      console.error(cause)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <PageHeader
        label="Automatisations"
        title="Templates de workflow"
        actions={
          <Button onClick={() => setTeachOpen(true)}>
            <GraduationCap className="w-4 h-4" /> Apprendre en le faisant
          </Button>
        }
      />
      {orgId && <p className="mb-4 text-sm text-muted-foreground">partagé avec l&apos;équipe</p>}
      {error ? (
        <Alert variant="destructive"><AlertDescription>Impossible de charger les workflows : {error.message}</AlertDescription></Alert>
      ) : isLoading ? (
        <Card className="p-4 text-sm text-muted-foreground">Chargement des workflows…</Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {workflows.map((flow) => (
            <Card key={flow.id} className="p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Workflow className="w-4 h-4 text-muted-foreground" />
                  <p className="font-semibold">{flow.title}</p>
                </div>
                <Badge tone={flow.tone}>{flow.marketplace}</Badge>
              </div>
              {flow.intent?.goal && <p className="text-sm mb-2"><span className="font-medium">Objectif :</span> {flow.intent.goal}</p>}
              {flow.intent?.success_criteria && <p className="text-xs text-muted-foreground mb-2"><span className="font-medium">Résultat attendu :</span> {flow.intent.success_criteria}</p>}
              {!!flow.guardrails?.length && (
                <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5 mb-3">
                  {flow.guardrails.map((guardrail) => <li key={guardrail}>{guardrail}</li>)}
                </ul>
              )}
              <ol className="space-y-2 text-sm flex-1 mb-4">
                {flow.steps.map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="size-6 rounded-full bg-muted text-foreground text-xs font-semibold flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setRunning(flow)}>
                  <Rocket className="w-3.5 h-3.5" /> Lancer maintenant
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={saving === flow.id}
                  onClick={() => void toggle(flow)}
                >
                  {flow.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {flow.enabled ? "Désactiver" : "Activer"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <RunWorkflowModal key={running?.id ?? "none"} workflow={running} onClose={() => setRunning(null)} request={request} />
      <TeachWorkflowModal
        key={String(teachOpen)}
        open={teachOpen}
        onClose={() => setTeachOpen(false)}
        request={request}
        onSaved={() => void mutate()}
      />
    </div>
  )
}
