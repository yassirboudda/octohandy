import Link from "next/link"
import { MessageSquareText, Package, Puzzle, Store, Workflow } from "lucide-react"
import { Card, PageHeader } from "@/components/ui"

const cards = [
  { href: "/dashboard/chat", title: "Chat agent", text: "Même UX Comie: messages, images, réponses mock / Nebius.", icon: MessageSquareText },
  { href: "/dashboard/shops", title: "Boutique", text: "Boutiques + annonces. Clic boutique → ses annonces.", icon: Store },
  { href: "/dashboard/extension", title: "Extension", text: "Chrome companion pour cookies Vinted / Leboncoin.", icon: Puzzle },
  { href: "/dashboard/stock", title: "Stock + équipe", text: "Code d'invitation pour fusionner les stocks entre membres.", icon: Package },
  { href: "/dashboard/workflows", title: "Workflows", text: "Templates par marketplace (ex. favoris Vinted → offre).", icon: Workflow },
]

export default function DashboardHome() {
  return (
    <div>
      <PageHeader
        label="Dashboard"
        title="POV Stockflow"
        subtitle="Front Vercel + API Hetzner. Boutique regroupe boutiques et annonces. Extension pour les cookies."
      />
      <div className="grid sm:grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href}>
            <Card interactive className="p-5 h-full">
              <c.icon className="w-5 h-5 text-secondary mb-3" />
              <p className="font-semibold">{c.title}</p>
              <p className="text-caption mt-1">{c.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
