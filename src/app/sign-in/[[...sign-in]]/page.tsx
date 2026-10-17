"use client"

import { Lock } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { Octopus } from "@/components/oh/octopus"
import { Button, Card, Input } from "@/components/ui"

function SignInForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })
    setBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(res.status === 401 ? "Mot de passe incorrect." : data.error || `Connexion impossible (${res.status}).`)
      return
    }
    router.replace(params.get("next") || "/dashboard")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm p-6">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className="font-heading text-xl">Accès à l&apos;espace</p>
          <p className="text-sm text-muted-foreground mt-1">Démo mono-utilisateur : entre le mot de passe d&apos;accès communiqué par l&apos;équipe OctoHandy.</p>
        </div>
        <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" aria-label="Mot de passe" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" loading={busy} disabled={!password}>
          <Lock className="w-4 h-4" /> Entrer
        </Button>
      </form>
    </Card>
  )
}

export default function SignInPage() {
  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-center gap-6 p-4">
      <Link href="/" className="flex items-center gap-2" aria-label="OctoHandy">
        <Octopus className="w-16" label="" />
        <span className="font-heading text-3xl text-foreground">OctoHandy</span>
      </Link>
      <p className="text-muted-foreground text-center max-w-sm -mt-2">Ton assistant marketplace : il surveille tes boutiques, prépare tes réponses et agit sur ton bureau distant.</p>
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  )
}
