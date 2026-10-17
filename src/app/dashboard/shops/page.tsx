"use client"

import { ExternalLink, MonitorSmartphone, Puzzle, RefreshCw, Store, Tags } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge, Button, Card, EmptyState, MarketplaceLogo, PageHeader, StatusDot } from "@/components/ui"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConnectMarketplaceModal } from "@/components/connect-marketplace"
import type { Shop } from "@/lib/store"
import { useWorkspaceResource } from "@/lib/use-workspace-resource"

const mpUrl: Record<string, string> = { vinted: "https://www.vinted.fr" }

export default function ShopsPage() {
  const router = useRouter()
  const { data, error, isLoading, request, mutate } = useWorkspaceResource<{ shops: Shop[] }>("/v1/shops")
  const shops = data?.shops ?? []
  const [connect, setConnect] = useState<{ open: boolean; marketplace: string | null }>({ open: false, marketplace: null })
  const openConnect = (marketplace: string | null = null) => setConnect({ open: true, marketplace })

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || !e.data || typeof e.data !== "object") return
      if (e.data.type === "OCTOHANDY_SHOP_CONNECTED") {
        void mutate()
        toast.success(`${e.data.marketplace} connecté via extension`)
      }
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [mutate])

  const refresh = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await request(`/v1/shops/${id}`, { method: "PATCH", body: { status: "connected" } })
      await mutate()
      toast.success("Session marquée valide")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible de vérifier la session")
    }
  }

  const openShop = (id: string) => router.push(`/dashboard/shops/${id}`)

  return (
    <div>
      <PageHeader
        label="Marketplace"
        title="Boutique"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <Link href="/dashboard/shops/all">
                <Tags className="w-4 h-4" /> Voir toutes les annonces
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/dashboard/extension">
                <Puzzle className="w-4 h-4" /> Extension cookies
              </Link>
            </Button>
            <Button onClick={() => openConnect()}>
              <MonitorSmartphone className="w-4 h-4" /> Connecter une marketplace
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="p-4 text-sm text-destructive">Impossible de charger les boutiques : {error.message}</Card>
      ) : isLoading ? (
        <Card className="p-4 text-sm text-muted-foreground">Chargement des boutiques…</Card>
      ) : !shops.length ? (
        <Card>
          <EmptyState
            icon={<Store className="w-6 h-6" />}
            title="Aucune boutique"
            text="Clique « Connecter une marketplace » : tu te connectes à Vinted, eBay, Etsy… dans le Chrome du bureau OctoHandy, et l&apos;agent travaille dans cette session."
            action={
              <Button asChild>
                <Link href="/dashboard/extension">
                  <Puzzle className="w-4 h-4" /> Installer l&apos;extension
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="py-1">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-muted-foreground">Boutique</TableHead>
                <TableHead className="text-muted-foreground">Session</TableHead>
                <TableHead className="text-muted-foreground text-right">Annonces</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shops.map((s) => {
                const ok = s.status === "connected"
                return (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => openShop(s.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        openShop(s.id)
                      }
                    }}
                    role="link"
                    tabIndex={0}
                  >
                    <TableCell className="pl-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <MarketplaceLogo marketplace={s.marketplace} size={32} />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{s.displayName}</p>
                          <Badge tone={s.marketplace === "vinted" ? "teal" : "slate"} className="mt-0.5">
                            {s.marketplace}
                          </Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 text-sm">
                        <StatusDot tone={ok ? "green" : "red"} live={ok} />
                        <span className={ok ? "text-foreground" : "text-destructive"}>{ok ? "Session valide" : "Session expirée"}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.listingCount}</TableCell>
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Button variant="secondary" size="sm" onClick={() => openShop(s.id)}>
                          <Tags className="w-3.5 h-3.5" /> Voir les annonces
                        </Button>
                        <Button variant={ok ? "secondary" : "primary"} size="sm" onClick={() => openConnect(s.marketplace)}>
                          <MonitorSmartphone className="w-4 h-4" /> {ok ? "Ouvrir le bureau" : "Reconnecter"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={(e) => void refresh(s.id, e)}>
                          <RefreshCw className="w-3.5 h-3.5" /> Vérifier
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={mpUrl[s.marketplace] ?? `https://www.${s.marketplace}.fr`} target="_blank" rel="noreferrer">
                            <ExternalLink className="w-3.5 h-3.5" /> Ouvrir
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <ConnectMarketplaceModal
        key={`${connect.open}-${connect.marketplace ?? ""}`}
        open={connect.open}
        initialMarketplace={connect.marketplace}
        onClose={() => setConnect({ open: false, marketplace: null })}
        request={request}
        onConnected={() => void mutate()}
      />
    </div>
  )
}
