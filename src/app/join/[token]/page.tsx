"use client"

import { useClerk, useAuth } from "@clerk/nextjs"
import { ArrowRight, Users } from "lucide-react"
import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Card } from "@/components/ui"
import { apiFetch } from "@/lib/api"

type InviteInfo = { orgId: string; orgName: string; expiresAt: string }

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: inviteToken } = use(params)
  const { getToken } = useAuth()
  const { setActive } = useClerk()
  const router = useRouter()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadInvite = async () => {
      try {
        const authToken = await getToken()
        if (!authToken) throw new Error("Connecte-toi pour consulter cette invitation.")
        const result = await apiFetch<InviteInfo>(`/v1/invites/${encodeURIComponent(inviteToken)}`, { token: authToken })
        if (!cancelled) setInvite(result)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : ""
        if (!cancelled) {
          if (message.includes("410") || message.toLowerCase().includes("expir")) {
            setError("Ce lien d'invitation a expiré. Demande un nouveau lien à l'équipe.")
          } else if (message.includes("404") || message.toLowerCase().includes("introuvable")) {
            setError("Ce lien d'invitation est introuvable ou invalide.")
          } else {
            setError(message || "Impossible de charger l'invitation.")
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadInvite()
    return () => {
      cancelled = true
    }
  }, [getToken, inviteToken])

  const acceptInvite = async () => {
    if (!invite) return
    setAccepting(true)
    try {
      const authToken = await getToken()
      if (!authToken) throw new Error("Connecte-toi pour rejoindre l'équipe.")
      await apiFetch(`/v1/invites/${encodeURIComponent(inviteToken)}/accept`, { method: "POST", token: authToken })
      await setActive({ organization: invite.orgId })
      router.push("/dashboard")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de rejoindre cette organisation.")
    } finally {
      setAccepting(false)
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-4 bg-background">
      <Card className="max-w-lg w-full p-8 text-center">
        <Users className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
        <h1 className="font-heading text-2xl">Invitation OctoHandy</h1>
        {loading ? (
          <p className="text-sm text-muted-foreground mt-3">Chargement de l&apos;invitation…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive mt-4">{error}</p>
        ) : invite ? (
          <>
            <p className="text-muted-foreground mt-3">
              Tu as été invité·e à rejoindre l&apos;organisation <strong className="text-foreground">{invite.orgName}</strong>.
            </p>
            <Button className="mt-6" loading={accepting} onClick={() => void acceptInvite()}>
              Rejoindre l&apos;équipe <ArrowRight className="w-4 h-4" />
            </Button>
          </>
        ) : null}
      </Card>
    </main>
  )
}
