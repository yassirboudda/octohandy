"use client"

import { ArrowLeft, Store, Tags } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ListingsGrid } from "@/components/listings-grid"
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, StatusDot } from "@/components/ui"
import { store, type Listing, type Shop } from "@/lib/store"

export default function ShopDetailPage() {
  const params = useParams()
  const shopId = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : ""
  const [shop, setShop] = useState<Shop | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!shopId) return
    store.getListings()
    const shops = store.getShops()
    setShop(shops.find((s) => s.id === shopId) || null)
    setListings(store.getListings(shopId))
    setReady(true)
  }, [shopId])

  const title = useMemo(() => shop?.displayName || "Boutique", [shop])

  if (!shopId) return null

  if (!ready) {
    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    )
  }

  if (!shop) {
    return (
      <Card>
        <EmptyState
          icon={<Store className="w-6 h-6" />}
          title="Boutique introuvable"
          text="Cette boutique n'existe pas dans le mock local. Retourne à Boutique."
          action={
            <Link href="/dashboard/shops">
              <Button size="sm">Retour boutiques</Button>
            </Link>
          }
        />
      </Card>
    )
  }

  return (
    <div>
      <PageHeader
        label="Boutique"
        title={title}
        subtitle={
          <span className="inline-flex items-center gap-2 flex-wrap">
            <Badge tone={shop.marketplace === "vinted" ? "teal" : "amber"}>{shop.marketplace}</Badge>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <StatusDot tone={shop.status === "connected" ? "green" : "red"} live={shop.status === "connected"} />
              {shop.status === "connected" ? "Session valide" : "Session expirée"}
            </span>
            <span className="text-sm text-muted-foreground">· {listings.length} annonces</span>
          </span>
        }
        actions={
          <>
            <Link href="/dashboard/shops">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-3.5 h-3.5" /> Boutiques
              </Button>
            </Link>
            <Link href="/dashboard/shops/all">
              <Button variant="secondary" size="sm">
                <Tags className="w-3.5 h-3.5" /> Voir toutes les annonces
              </Button>
            </Link>
          </>
        }
      />
      <ListingsGrid listings={listings} emptyText="Cette boutique n'a pas encore d'annonces." />
    </div>
  )
}
