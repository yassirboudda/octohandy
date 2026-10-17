"use client"

import { useUser } from "@clerk/nextjs"
import { Minus, Package, Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Button, Card, EmptyState, Input, PageHeader } from "@/components/ui"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { StockItem } from "@/lib/store"
import { useWorkspaceResource } from "@/lib/use-workspace-resource"

export default function StockPage() {
  const { user } = useUser()
  const { data, error, isLoading, request, mutate } = useWorkspaceResource<{ items: StockItem[] }>("/v1/stock")
  const [title, setTitle] = useState("")
  const [qty, setQty] = useState("1")
  const items = useMemo(() => data?.items ?? [], [data?.items])

  const totals = useMemo(
    () => ({
      qtySum: items.reduce((sum, item) => sum + item.qty, 0),
      owners: new Set(items.map((item) => item.createdBy ?? item.ownerLabel)).size,
    }),
    [items]
  )

  const addItem = async () => {
    if (!title.trim()) return
    try {
      await request("/v1/stock", {
        method: "POST",
        body: {
          title: title.trim(),
          qty: Math.max(1, Number(qty) || 1),
          ownerLabel: user?.firstName || "toi",
        },
      })
      await mutate()
      setTitle("")
      setQty("1")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible d'ajouter cet article")
    }
  }

  const updateQuantity = async (item: StockItem, amount: number) => {
    try {
      await request(`/v1/stock/${item.id}`, {
        method: "PATCH",
        body: { qty: Math.max(0, item.qty + amount) },
      })
      await mutate()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible de modifier la quantité")
    }
  }

  const removeItem = async (item: StockItem) => {
    try {
      await request(`/v1/stock/${item.id}`, { method: "DELETE" })
      await mutate()
      toast.success("Article supprimé")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible de supprimer cet article")
    }
  }

  return (
    <div>
      <PageHeader
        label="Inventaire"
        title="Stock"
      />

      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-muted-foreground">
          {items.length} lignes · {totals.qtySum} pièces · {totals.owners} propriétaire(s)
        </p>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nouvel article" aria-label="Nouvel article" className="flex-1" />
          <Input value={qty} onChange={(event) => setQty(event.target.value)} type="number" min={1} aria-label="Quantité" className="w-24" />
          <Button onClick={() => void addItem()}>
            <Plus className="w-4 h-4" /> Ajouter
          </Button>
        </div>
      </Card>

      {error ? (
        <Card className="p-4 text-sm text-destructive">Impossible de charger le stock : {error.message}</Card>
      ) : isLoading ? (
        <Card className="p-4 text-sm text-muted-foreground">Chargement du stock…</Card>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<Package className="w-6 h-6" />} title="Stock vide" text="Ajoute un article à l'inventaire." />
        </Card>
      ) : (
        <Card className="py-1">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-muted-foreground">Article</TableHead>
                <TableHead className="text-muted-foreground">Propriétaire</TableHead>
                <TableHead className="text-muted-foreground">Marketplace</TableHead>
                <TableHead className="text-muted-foreground text-right">Prix</TableHead>
                <TableHead className="pr-4 text-muted-foreground text-right">Quantité</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="pl-4 font-medium max-w-64 truncate">{item.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.createdBy === user?.id
                      ? "toi"
                      : item.creatorName || (item.ownerLabel === "toi" ? "un membre" : item.ownerLabel)}
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">{item.marketplace || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.price != null ? `${item.price} €` : "—"}</TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" aria-label={`Retirer une unité de ${item.title}`} onClick={() => void updateQuantity(item, -1)}>
                        <Minus className="w-3.5 h-3.5" />
                      </Button>
                      <span className="min-w-8 text-center tabular-nums font-medium">{item.qty}</span>
                      <Button variant="ghost" size="sm" aria-label={`Ajouter une unité de ${item.title}`} onClick={() => void updateQuantity(item, 1)}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Supprimer ${item.title}`} onClick={() => void removeItem(item)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
