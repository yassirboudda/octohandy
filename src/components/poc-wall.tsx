import { SignOutButton } from "@clerk/nextjs"
import { LockKeyhole } from "lucide-react"
import { Button, Card } from "./ui"

export type PocAccess = {
  allowedEmail: string
  judgeEmail: string
  judgePassword: string
}

export function pocAccess(): PocAccess {
  return {
    allowedEmail: (process.env.POC_ALLOWED_EMAIL || "yassirboudda@gmail.com").trim().toLowerCase(),
    judgeEmail: process.env.POC_JUDGE_EMAIL || "",
    judgePassword: process.env.POC_JUDGE_PASSWORD || "",
  }
}

export function isPocAllowed(email: string | null | undefined, access: PocAccess) {
  return !!email && email.trim().toLowerCase() === access.allowedEmail
}

export function PocWall({ currentEmail, access }: { currentEmail: string | null; access: PocAccess }) {
  const judgeEmail = access.judgeEmail || access.allowedEmail
  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-lg w-full p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-5">
          <LockKeyhole className="w-6 h-6 text-secondary" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Accès limité pendant le PoC</h1>
        <p className="text-muted-foreground mt-3">
          Pendant cette phase de PoC (hackathon), seul le compte <span className="font-medium text-foreground">{access.allowedEmail}</span>{" "}
          peut se connecter à Stockflow : l&apos;instance cloud (navigateur distant, Screenpipe, agent Hermes) est dédiée à un seul utilisateur.
        </p>
        <div className="mt-6 rounded-xl border border-border/70 bg-white text-left p-4">
          <p className="text-sm font-semibold">Vous êtes juge ? Utilisez ces identifiants :</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-mono break-all select-all">{judgeEmail}</dd>
            <dt className="text-muted-foreground">Mot de passe</dt>
            <dd className="font-mono break-all select-all">{access.judgePassword || "(communiqué par l'équipe Stockflow)"}</dd>
          </dl>
          <p className="text-xs text-muted-foreground mt-3">
            Indice : le mot de passe est le nom du sponsor de l&apos;événement.
          </p>
        </div>
        {currentEmail && (
          <p className="text-xs text-muted-foreground mt-4">
            Connecté en tant que <span className="font-mono">{currentEmail}</span>
          </p>
        )}
        <div className="mt-6 flex justify-center">
          <SignOutButton redirectUrl="/sign-in">
            <Button>Se déconnecter et changer de compte</Button>
          </SignOutButton>
        </div>
      </Card>
    </div>
  )
}
