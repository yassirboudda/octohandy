"use client"

import { useAuth, useOrganization } from "@clerk/nextjs"
import { Copy, Link2, Users } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge, Button, Card, Field, Input, PageHeader, Textarea } from "@/components/ui"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiFetch } from "@/lib/api"
import { useWorkspaceResource } from "@/lib/use-workspace-resource"

type AgentProfile = {
  displayName: string
  preferences: Record<string, unknown>
}

function AgentProfileCard() {
  const { data, error, isLoading, request, mutate } = useWorkspaceResource<{ profile: AgentProfile }>("/v1/me/profile")
  const [nameDraft, setNameDraft] = useState<string | undefined>()
  const [notesDraft, setNotesDraft] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const profile = data?.profile
  const displayName = nameDraft ?? profile?.displayName ?? ""
  const savedNotes = typeof profile?.preferences?.notes === "string" ? profile.preferences.notes : ""
  const notes = notesDraft ?? savedNotes

  const saveProfile = async () => {
    setSaving(true)
    try {
      await request("/v1/me/profile", {
        method: "PUT",
        body: { displayName, preferences: { notes } },
      })
      await mutate()
      setNameDraft(undefined)
      setNotesDraft(undefined)
      toast.success("Profil enregistré")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible d'enregistrer le profil")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5 mb-5">
      <h2 className="font-semibold">Mon profil (lu par l&apos;agent)</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">Ton profil reste personnel, même dans une organisation.</p>
      {error && <p role="alert" className="text-sm text-destructive mb-3">Impossible de charger le profil : {error.message}</p>}
      <div className="space-y-4">
        <Field label="Nom affiché">
          <Input
            value={displayName}
            onChange={(event) => setNameDraft(event.target.value)}
            disabled={isLoading || saving}
            placeholder="Ton nom"
          />
        </Field>
        <Field label="Préférences pour l'agent">
          <Textarea
            value={notes}
            onChange={(event) => setNotesDraft(event.target.value)}
            disabled={isLoading || saving}
            placeholder="Ton, signature, habitudes…"
          />
        </Field>
        <Button size="sm" loading={saving} disabled={isLoading} onClick={() => void saveProfile()}>
          Enregistrer le profil
        </Button>
      </div>
    </Card>
  )
}

export default function TeamPage() {
  const { orgId, isLoaded, getToken } = useAuth()
  const { organization, memberships } = useOrganization({ memberships: { infinite: true } })
  const [inviteUrl, setInviteUrl] = useState("")
  const [creating, setCreating] = useState(false)
  const members = memberships?.data ?? []

  const createInvite = async () => {
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Session Clerk introuvable")
      const result = await apiFetch<{ path: string }>("/v1/org/invite-links", { method: "POST", token })
      setInviteUrl(`${window.location.origin}${result.path}`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible de créer le lien")
    } finally {
      setCreating(false)
    }
  }

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl)
    toast.success("Lien copié")
  }

  if (!isLoaded) return <Card className="p-5 text-sm text-muted-foreground">Chargement de l&apos;équipe…</Card>

  if (!orgId) {
    return (
      <div>
        <PageHeader label="Espace de travail" title="Équipe" />
        <AgentProfileCard />
        <Card className="p-5">
          <p className="font-semibold">Aucune organisation sélectionnée</p>
          <p className="text-sm text-muted-foreground mt-2">
            Utilise le sélecteur d&apos;organisation en haut de la page pour créer une organisation ou en rejoindre une.
            Ton espace personnel reste disponible séparément.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        label="Espace partagé"
        title={organization?.name || "Équipe"}
        actions={
          <Button loading={creating} onClick={() => void createInvite()}>
            <Link2 className="w-4 h-4" /> Créer un lien d&apos;invitation
          </Button>
        }
      />
      <AgentProfileCard />
      {inviteUrl && (
        <Card className="p-4 mb-5 space-y-2">
          <p className="text-sm font-medium">Lien valable 7 jours</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 min-w-0 break-all rounded-md border bg-muted px-2.5 py-2 font-mono text-xs">{inviteUrl}</code>
            <Button variant="secondary" size="sm" onClick={() => void copyInvite()}>
              <Copy className="w-3.5 h-3.5" /> Copier
            </Button>
          </div>
        </Card>
      )}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold">Membres</h2>
          <Badge>{members.length}</Badge>
        </div>
        {!members.length ? (
          <p className="text-sm text-muted-foreground">Chargement des membres…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-0 text-muted-foreground">Membre</TableHead>
                <TableHead className="text-muted-foreground">Identifiant</TableHead>
                <TableHead className="pr-0 text-muted-foreground text-right">Rôle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((membership) => {
                const publicUser = membership.publicUserData
                const name = [publicUser?.firstName, publicUser?.lastName].filter(Boolean).join(" ")
                return (
                  <TableRow key={membership.id}>
                    <TableCell className="pl-0 font-medium">{name || publicUser?.identifier || "Membre"}</TableCell>
                    <TableCell className="text-muted-foreground">{publicUser?.identifier}</TableCell>
                    <TableCell className="pr-0 text-right">
                      <Badge>{membership.roleName}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {memberships?.hasNextPage && (
          <Button className="mt-4" variant="secondary" size="sm" onClick={() => void memberships.fetchNext()}>
            Charger plus de membres
          </Button>
        )}
      </Card>
    </div>
  )
}
