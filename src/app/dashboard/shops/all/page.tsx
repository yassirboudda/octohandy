"use client"

import { ArrowLeft, Store } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { ListingsGrid } from "@/components/listings-grid"
import { Button, PageHeader, Segmented } from "@/components/ui"
import type { Listing, Shop } from "@/lib/store"
import { useWorkspaceResource } from "@/lib/use-workspace-resource"

export default function AllListingsPage() {
  const listingsResource = useWorkspaceResource<{ listings: Listing[] }>("/v1/listings")
  const shopsResource = useWorkspaceResource<{ shops: Shop[] }>("/v1/shops")
  const listings = useMemo(() => listingsResource.data?.listings ?? [], [listingsResource.data?.listings])
  const shops = useMemo(() => shopsResource.data?.shops ?? [], [shopsResource.data?.shops])
  const [filter, setFilter] = useState("all")

  const options = useMemo(
    () => [{ value: "all", label: "Toutes" }, ...shops.map((s) => ({ value: s.id, label: s.displayName }))],
    [shops]
  )

  const visible = filter === "all" ? listings : listings.filter((l) => l.shopId === filter)

  return (
    <div>
      <PageHeader
        label="Marketplace"
        title="Toutes les annonces"
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/shops">
              <ArrowLeft className="w-3.5 h-3.5" /> Retour boutiques
            </Link>
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented options={options} value={filter} onChange={setFilter} />
        <Link href="/dashboard/shops" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <Store className="w-3.5 h-3.5" /> Gérer les boutiques
        </Link>
      </div>
      {listingsResource.error || shopsResource.error ? (
        <p className="text-sm text-destructive">Impossible de charger les annonces et boutiques.</p>
      ) : (
        <ListingsGrid listings={visible} />
      )}
    </div>
  )
}
