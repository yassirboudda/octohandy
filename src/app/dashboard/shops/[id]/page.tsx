"use client"

import { ArrowLeft, Store, Tags } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ListingsGrid } from "@/components/listings-grid"
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, StatusDot } from "@/components/ui"
import type { Listing, Shop } from "@/lib/store"
import { useWorkspaceResource } from "@/lib/use-workspace-resource"

export default function ShopDetailPage() {
  const params = useParams<{ id: string }>()
  const shopId = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : ""
  const shopsResource = useWorkspaceResource<{ shops: Shop[] }>("/v1/shops")
  const listingsResource = useWorkspaceResource<{ listings: Listing[] }>(`/v1/shops/${encodeURIComponent(shopId)}/listings`)
  const shop = shopsResource.data?.shops.find((entry) => entry.id === shopId) ?? null
  const listings = listingsResource.data?.listings ?? []
  const isLoading = shopsResource.isLoading || listingsResource.isLoading
  const title = shop?.displayName || "Boutique"

  if (!shopId) return null

  if (isLoading) {
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
          text="Cette boutique n'existe pas dans cet espace. Retourne à Boutique."
          action={
            <Button size="sm" asChild>
              <Link href="/dashboard/shops">Retour boutiques</Link>
            </Button>
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
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/shops">
                <ArrowLeft className="w-3.5 h-3.5" /> Boutiques
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/shops/all">
                <Tags className="w-3.5 h-3.5" /> Voir toutes les annonces
              </Link>
            </Button>
          </>
        }
      />
      <ListingsGrid listings={listings} emptyText="Cette boutique n'a pas encore d'annonces." />
    </div>
  )
}
