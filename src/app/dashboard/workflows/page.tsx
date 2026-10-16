"use client"

import { Play, Workflow } from "lucide-react"
import { toast } from "sonner"
import { Badge, Button, Card, PageHeader } from "@/components/ui"

type Flow = {
  id: string
  marketplace: "vinted" | "leboncoin" | "multi"
  title: string
  steps: string[]
  tone: "teal" | "amber" | "blue"
}

const flows: Flow[] = [
  {
    id: "vinted-fav-offer",
    marketplace: "vinted",
    title: "Favoris → offre discount",
    tone: "teal",
    steps: [
      "Client met un article en favoris",
      "Détection via messagerie / notif (backend plus tard)",
      "Envoi d'un message avec proposition de prix (discount)",
    ],
  },
  {
    id: "vinted-bump",
    marketplace: "vinted",
    title: "Annonce dormante → baisse auto",
    tone: "teal",
    steps: ["Annonce sans vue depuis N jours", "Calcul d'une baisse X%", "Mise à jour prix + message optionnel"],
  },
  {
    id: "lbc-first-msg",
    marketplace: "leboncoin",
    title: "Premier message → réponse type",
    tone: "amber",
    steps: ["Nouveau message acheteur", "Classement intent (dispo / prix / RDV)", "Réponse template + plancher vendeur"],
  },
  {
    id: "multi-restock",
    marketplace: "multi",
    title: "Stock équipe → republish",
    tone: "blue",
    steps: ["Article ajouté au stock partagé", "Choix marketplace", "Création / republication de l'annonce"],
  },
]

export default function WorkflowsPage() {
  return (
    <div>
      <PageHeader
        label="Automatisations"
        title="Templates de workflow"
        subtitle="Exemples par marketplace. Pas d'exécution réelle: c'est la carte POV pour le hackathon."
      />
      <div className="grid md:grid-cols-2 gap-4">
        {flows.map((f) => (
          <Card key={f.id} className="p-5 flex flex-col">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Workflow className="w-4 h-4 text-secondary" />
                <p className="font-semibold">{f.title}</p>
              </div>
              <Badge tone={f.tone}>{f.marketplace}</Badge>
            </div>
            <ol className="space-y-2 text-sm flex-1 mb-4">
              {f.steps.map((s, i) => (
                <li key={s} className="flex gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#0f172a] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-muted-foreground">{s}</span>
                </li>
              ))}
            </ol>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => toast.message("POV: workflow non branché", { description: "Le backend VPS exécutera ça plus tard." })}
            >
              <Play className="w-3.5 h-3.5" /> Activer (bientôt)
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}
