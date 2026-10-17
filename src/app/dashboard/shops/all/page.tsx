"use client"

import { ArrowLeft, Store } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ListingsGrid } from "@/components/listings-grid"
import { Button, PageHeader, Segmented } from "@/components/ui"
import { store, type Listing, type Shop } from "@/lib/store"

export default function AllListingsPage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [filter, setFilter] = useState("all")

  useEffect(() => {
    setListings(store.getListings())
    setShops(store.getShops())
  }, [])

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
        subtitle={`${visible.length} annonce${visible.length > 1 ? "s" : ""} · boutiques + listings regroupés dans Boutique.`}
        actions={
          <Link href="/dashboard/shops">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="w-3.5 h-3.5" /> Retour boutiques
            </Button>
          </Link>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented options={options} value={filter} onChange={setFilter} />
        <Link href="/dashboard/shops" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <Store className="w-3.5 h-3.5" /> Gérer les boutiques
        </Link>
      </div>
      <ListingsGrid listings={visible} />
    </div>
  )
}
