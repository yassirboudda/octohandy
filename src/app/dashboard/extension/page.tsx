"use client"

import { useAuth } from "@clerk/nextjs"
import { Check, Copy, Download, Puzzle, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Badge, Button, Card, PageHeader, StatusDot } from "@/components/ui"
import { apiFetch } from "@/lib/api"

function useExtensionPresence() {
  const [version, setVersion] = useState<string | null>(null)
  const [paired, setPaired] = useState(false)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || !e.data || typeof e.data !== "object") return
      if (e.data.type === "STOCKFLOW_EXTENSION_READY" || e.data.type === "STOCKFLOW_PONG") {
        setVersion(e.data.version || "?")
        setPaired(Boolean(e.data.paired))
      }
      if (e.data.type === "STOCKFLOW_PAIRED") setPaired(true)
    }
    window.addEventListener("message", onMsg)
    window.postMessage({ type: "STOCKFLOW_PING" }, window.location.origin)
    const id = setInterval(() => window.postMessage({ type: "STOCKFLOW_PING" }, window.location.origin), 3000)
    return () => {
      window.removeEventListener("message", onMsg)
      clearInterval(id)
    }
  }, [])
  return { version, paired, setPaired }
}

export default function ExtensionPage() {
  const { getToken } = useAuth()
  const { version, paired, setPaired } = useExtensionPresence()
  const [pairing, setPairing] = useState(false)
  const [manualToken, setManualToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const autoTried = useRef(false)

  const pair = useCallback(async () => {
    setPairing(true)
    setManualToken(null)
    try {
      const clerkToken = await getToken()
      if (!clerkToken) throw new Error("Connecte-toi d'abord")
      const { token } = await apiFetch<{ token: string }>("/v1/extension/pair", {
        method: "POST",
        body: { name: `Chrome ${navigator.platform || ""}`.trim() },
        token: clerkToken,
      })
      const apiUrl = `${window.location.origin}/backend`
      let acked = false
      let failReason: string | null = null
      const onAck = (e: MessageEvent) => {
        if (e.source !== window) return
        if (e.data?.type === "STOCKFLOW_PAIRED") acked = true
        if (e.data?.type === "STOCKFLOW_PAIR_FAILED") failReason = e.data.error || "Association refusée"
      }
      window.addEventListener("message", onAck)
      window.postMessage({ type: "STOCKFLOW_PAIR", token, api: apiUrl }, window.location.origin)
      await new Promise((r) => setTimeout(r, 1800))
      window.removeEventListener("message", onAck)
      if (acked) {
        setPaired(true)
        toast.success("Extension associée")
      } else if (failReason) {
        setManualToken(token)
        toast.error(failReason)
      } else {
        setManualToken(token)
        toast.message("Extension pas détectée. Installe le zip puis recharge cette page.")
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Échec association")
    } finally {
      setPairing(false)
    }
  }, [getToken, setPaired])

  useEffect(() => {
    if (!version || paired || pairing || autoTried.current) return
    autoTried.current = true
    const timer = setTimeout(() => void pair(), 600)
    return () => clearTimeout(timer)
  }, [version, paired, pairing, pair])

  const copy = async () => {
    if (!manualToken) return
    await navigator.clipboard.writeText(manualToken)
    setCopied(true)
    toast.success("Code copié")
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <PageHeader
        label="Connecteurs"
        title="Extension Chrome"
        subtitle="C'est elle qui récupère les cookies Vinted / Leboncoin pour brancher tes vraies boutiques."
        actions={
          <a href="/stockflow-extension.zip" download>
            <Button size="sm">
              <Download className="w-3.5 h-3.5" /> Télécharger l'extension
            </Button>
          </a>
        }
      />

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-secondary" />
            <p className="font-semibold">Statut</p>
          </div>
          <p className="text-sm inline-flex items-center gap-2">
            <StatusDot tone={version ? "green" : "slate"} live={Boolean(version)} />
            {version ? `Installée · v${version}` : "Pas détectée dans ce navigateur"}
          </p>
          <p className="text-sm inline-flex items-center gap-2">
            <StatusDot tone={paired ? "green" : "amber"} />
            {paired ? "Associée à ton compte" : "Pas encore associée"}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" loading={pairing} onClick={() => void pair()}>
              <RefreshCw className="w-3.5 h-3.5" /> {paired ? "Réassocier" : "Associer"}
            </Button>
            <a href="/stockflow-extension.zip" download>
              <Button variant="secondary" size="sm">
                <Download className="w-3.5 h-3.5" /> ZIP
              </Button>
            </a>
          </div>
          {manualToken ? (
            <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Code manuel (colle-le dans le popup de l'extension)</p>
              <code className="block text-xs break-all font-mono">{manualToken}</code>
              <Button variant="ghost" size="sm" onClick={() => void copy()}>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copier
              </Button>
            </div>
          ) : null}
        </Card>

        <Card className="p-5 space-y-3">
          <p className="font-semibold">Installation (2 min)</p>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal pl-4">
            <li>
              Télécharge <Badge tone="blue">stockflow-extension.zip</Badge> puis dézippe-le.
            </li>
            <li>
              Chrome → <code className="text-xs">chrome://extensions</code> → active le mode développeur.
            </li>
            <li>« Charger l&apos;extension non empaquetée » → choisis le dossier dézippé.</li>
            <li>Reviens ici, clique Associer, puis ouvre Vinted / Leboncoin et Connecter dans le popup.</li>
          </ol>
        </Card>
      </div>
    </div>
  )
}
