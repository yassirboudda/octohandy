"use client"

import { ExternalLink, RefreshCw, Store } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge, Button, Card, EmptyState, PageHeader, StatusDot } from "@/components/ui"
import { store, type Shop } from "@/lib/store"

const mpUrl = { leboncoin: "https://www.leboncoin.fr", vinted: "https://www.vinted.fr" }

export default function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([])

  useEffect(() => setShops(store.getShops()), [])

  const refresh = (id: string) => {
    const next = shops.map((s) => (s.id === id ? { ...s, status: "connected" as const } : s))
    setShops(next)
    store.setShops(next)
    toast.success("Session marquée OK (mock)")
  }

  return (
    <div>
      <PageHeader
        label="Marketplace"
        title="Boutique"
        subtitle="Même idée que Comie: comptes connectés. Ici tout est mock en local."
      />
      {!shops.length ? (
        <Card>
          <EmptyState icon={<Store className="w-6 h-6" />} title="Aucune boutique" text="Les boutiques mock se créent au premier chargement." />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {shops.map((s) => {
            const ok = s.status === "connected"
            return (
              <Card key={s.id} className="p-5">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center font-bold text-sm uppercase relative">
                    {s.marketplace.slice(0, 2)}
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-[3px] shadow">
                      <StatusDot tone={ok ? "green" : "red"} live={ok} />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold truncate">{s.displayName}</p>
                      <Badge tone={s.marketplace === "vinted" ? "teal" : "amber"}>{s.marketplace}</Badge>
                    </div>
                    <p className={`text-xs mt-1.5 font-medium ${ok ? "text-emerald-700" : "text-red-600"}`}>
                      {ok ? "Session valide (mock)" : "Session expirée (mock)"}
                    </p>
                    <p className="text-caption mt-1">{s.listingCount} annonces</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button variant="secondary" size="sm" onClick={() => refresh(s.id)}>
                    <RefreshCw className="w-3.5 h-3.5" /> Vérifier
                  </Button>
                  <a href={mpUrl[s.marketplace]} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="w-3.5 h-3.5" /> Ouvrir
                    </Button>
                  </a>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
