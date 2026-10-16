"use client"

import { useUser } from "@clerk/nextjs"
import { Copy, Link2, Package, Plus, Users } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader } from "@/components/ui"
import { store, type StockItem, type Team } from "@/lib/store"

export default function StockPage() {
  const { user } = useUser()
  const me = user?.primaryEmailAddress?.emailAddress || user?.fullName || "toi"
  const [items, setItems] = useState<StockItem[]>([])
  const [team, setTeam] = useState<Team | null>(null)
  const [teamName, setTeamName] = useState("Mon équipe")
  const [joinCode, setJoinCode] = useState("")
  const [title, setTitle] = useState("")
  const [qty, setQty] = useState("1")

  useEffect(() => {
    setItems(store.getStock(me))
    setTeam(store.getTeam())
  }, [me])

  const totals = useMemo(() => {
    const qtySum = items.reduce((a, i) => a + i.qty, 0)
    const owners = new Set(items.map((i) => i.ownerLabel))
    return { qtySum, owners: owners.size }
  }, [items])

  const createTeam = () => {
    const t = store.createTeam(teamName.trim() || "Mon équipe", me)
    setTeam(t)
    toast.success(`Code équipe: ${t.code}`)
  }

  const join = () => {
    if (!joinCode.trim()) return toast.error("Entre un code")
    const t = store.joinTeam(joinCode.trim(), me)
    if (!t) return toast.error("Code invalide")
    setTeam(t)
    const merged = store.mergeStockFromPeer(`membre-${t.code}`)
    setItems(merged)
    toast.success("Équipe rejointe · stocks fusionnés (POV)")
  }

  const copyCode = async () => {
    if (!team) return
    await navigator.clipboard.writeText(team.code)
    toast.success("Code copié")
  }

  const addItem = () => {
    if (!title.trim()) return
    const next = [
      ...items,
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        qty: Math.max(1, Number(qty) || 1),
        ownerLabel: me,
        marketplace: "vinted",
      },
    ]
    setItems(next)
    store.setStock(next)
    setTitle("")
    setQty("1")
  }

  return (
    <div>
      <PageHeader
        label="Inventaire"
        title="Stock"
        subtitle="Crée une équipe, partage un code, fusionne les stocks des membres. Front-only pour la POV."
      />

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-secondary" />
            <p className="font-semibold">Équipe</p>
          </div>
          {team ? (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-medium">{team.name}</span>
                <span className="text-muted-foreground"> · {team.members.length} membre(s)</span>
              </p>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-bold tracking-widest bg-muted/50 px-3 py-2 rounded-xl">{team.code}</code>
                <Button variant="secondary" size="sm" onClick={() => void copyCode()}>
                  <Copy className="w-3.5 h-3.5" /> Copier
                </Button>
              </div>
              <p className="text-caption">Partage ce code à un coéquipier pour merger vos stocks.</p>
              <ul className="text-sm space-y-1">
                {team.members.map((m) => (
                  <li key={m} className="text-muted-foreground">
                    · {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Nom d'équipe">
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Hackathon crew" />
              </Field>
              <Button onClick={createTeam}>
                <Plus className="w-4 h-4" /> Créer et obtenir un code
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-secondary" />
            <p className="font-semibold">Rejoindre une équipe</p>
          </div>
          <Field label="Code reçu">
            <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="ABC123" className="font-mono tracking-widest" />
          </Field>
          <Button variant="secondary" onClick={join}>
            Rejoindre et merger le stock
          </Button>
          <p className="text-caption">POV: le merge ajoute un stock fictif du peer dans ton inventaire local.</p>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-muted-foreground">
          {items.length} lignes · {totals.qtySum} pièces · {totals.owners} propriétaire(s)
        </p>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvel article" className="flex-1" />
          <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={1} className="w-24" />
          <Button onClick={addItem}>
            <Plus className="w-4 h-4" /> Ajouter
          </Button>
        </div>
      </Card>

      {!items.length ? (
        <Card>
          <EmptyState icon={<Package className="w-6 h-6" />} title="Stock vide" text="Ajoute un article ou rejoins une équipe." />
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((i) => (
            <Card key={i.id} className="px-4 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{i.title}</p>
                <p className="text-caption truncate">
                  {i.ownerLabel}
                  {i.marketplace ? ` · ${i.marketplace}` : ""}
                  {i.price != null ? ` · ${i.price} €` : ""}
                </p>
              </div>
              <Badge tone="blue">×{i.qty}</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
