import Link from "next/link"
import { Button } from "@/components/ui"

export default function HomePage() {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="max-w-5xl mx-auto w-full px-4 py-5 flex items-center justify-between">
        <p className="font-bold text-lg tracking-tight">Stockflow</p>
        <div className="flex gap-2">
          <Link href="/sign-in">
            <Button variant="secondary" size="sm">
              Se connecter
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">Créer un compte</Button>
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center">
        <div className="max-w-5xl mx-auto px-4 py-16 w-full">
          <p className="text-label mb-3">Hackathon POV · même Clerk que Comie</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight max-w-2xl leading-[1.1]">
            Chat agent, boutiques, stock d&apos;équipe et workflows marketplace.
          </h1>
          <p className="text-body-muted mt-4 max-w-xl">
            Front-only pour la démo. Backend sur un autre VPS plus tard. Login Clerk partagé avec Comie.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/sign-up">
              <Button>Lancer la POV</Button>
            </Link>
            <Link href="/sign-in">
              <Button variant="secondary">J&apos;ai déjà un compte</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
