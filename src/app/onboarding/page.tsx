"use client"

import { useUser } from "@clerk/nextjs"
import { AnimatePresence, MotionConfig, motion } from "framer-motion"
import { ArrowRight, Check, MessageSquareText, PackagePlus, Reply } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { CONNECTABLE_MARKETPLACES, ConnectMarketplaceModal, marketplaceName } from "@/components/connect-marketplace"
import { Octopus } from "@/components/oh/octopus"
import { Button, Card, MarketplaceLogo } from "@/components/ui"
import { Progress } from "@/components/ui/progress"
import type { Shop } from "@/lib/store"
import { cn } from "@/lib/utils"
import { missionHref, type MissionId } from "@/lib/missions"
import { useWorkspaceResource } from "@/lib/use-workspace-resource"

const STEPS = ["Vos marketplaces", "Première boutique", "Première mission"]
const EASE = [0.16, 1, 0.3, 1] as const

// Steps slide in the direction of travel: forward comes from the right, back from the left.
const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 32 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -32, transition: { duration: 0.2 } }),
}

export default function OnboardingPage() {
  const router = useRouter()
  const { user } = useUser()
  const { data, request, mutate } = useWorkspaceResource<{ shops: Shop[] }>("/v1/shops")
  const [[step, dir], setNav] = useState([0, 1])
  const setStep = (next: number) => setNav([next, next > step ? 1 : -1])
  const [picked, setPicked] = useState<string[]>([])
  const [connecting, setConnecting] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const connected = (data?.shops ?? []).filter((s) => s.status === "connected")
  const main = connected[0]?.marketplace ?? picked[0] ?? "vinted"
  const mainName = marketplaceName(main)

  // Saved on the Clerk user so /dashboard stops sending them here; failure must not trap them.
  const finish = async (mission?: MissionId) => {
    setLeaving(true)
    await user?.update({ unsafeMetadata: { ...user.unsafeMetadata, onboarded: true, marketplaces: picked } }).catch(() => undefined)
    router.push(mission ? missionHref(mission, main) : "/dashboard/chat")
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const missions: { id: MissionId; icon: typeof Reply; title: string; text: string }[] = [
    { id: "summary", icon: MessageSquareText, title: `Voir mes annonces ${mainName}`, text: "Un résumé de ce qui est en ligne, vendu, à relancer." },
    { id: "reply", icon: Reply, title: "Répondre à mes acheteurs", text: "Montrez une fois à l'octopus, il répondra ensuite pour vous." },
    { id: "publish", icon: PackagePlus, title: "Publier un article", text: "Décrivez-le en une phrase, l'octopus prépare l'annonce." },
  ]

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="mx-auto w-full max-w-2xl px-4 pt-6 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 mr-auto" aria-label="OctoHandy">
          <Octopus still className="w-8" label="" />
          <span className="font-heading text-lg">OctoHandy</span>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => void finish()} disabled={leaving}>
          Passer
        </Button>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 flex-1">
        <div className="mb-8">
          <div className="flex justify-between text-caption mb-2">
            <span>
              Étape {step + 1} sur {STEPS.length} · {STEPS[step]}
            </span>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} aria-label="Progression" />
        </div>

        <AnimatePresence mode="wait" custom={dir} initial={false}>
        {step === 0 && (
          <motion.section key={0} custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
            <h1 className="text-title">Où vendez-vous aujourd&apos;hui ?</h1>
            <p className="text-body-muted mt-1">L&apos;octopus surveillera ces marketplaces pour vous. Vous pourrez en ajouter plus tard.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6" role="group" aria-label="Marketplaces">
              {CONNECTABLE_MARKETPLACES.map((m) => {
                const on = picked.includes(m.id)
                return (
                  <motion.button
                    key={m.id}
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    aria-pressed={on}
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "relative flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-sm font-medium transition-colors outline-none hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      on && "border-foreground bg-butter/40"
                    )}
                  >
                    <AnimatePresence>
                      {on && (
                        <motion.span
                          className="absolute right-2 top-2"
                          initial={{ scale: 0, rotate: -30 }}
                          animate={{ scale: 1, rotate: 0, transition: { type: "spring", stiffness: 500, damping: 18 } }}
                          exit={{ scale: 0, transition: { duration: 0.12 } }}
                        >
                          <Check className="size-4" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <MarketplaceLogo marketplace={m.id} size={36} />
                    <span className="text-center leading-tight">{m.name}</span>
                  </motion.button>
                )
              })}
            </div>
            <div className="mt-8 flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!picked.length}>
                Continuer <ArrowRight />
              </Button>
            </div>
          </motion.section>
        )}

        {step === 1 && (
          <motion.section key={1} custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
            <h1 className="text-title">Connectez votre première boutique</h1>
            <p className="text-body-muted mt-1">
              Vous vous connectez vous-même dans un navigateur sécurisé. OctoHandy ne voit jamais votre mot de passe.
            </p>
            <div className="mt-6 grid gap-3">
              {picked.map((id) => {
                const shop = connected.find((s) => s.marketplace === id)
                return (
                  <Card key={id} className="flex items-center gap-3 p-4">
                    <MarketplaceLogo marketplace={id} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{marketplaceName(id)}</p>
                      <p className="text-caption truncate">{shop ? `Connectée · ${shop.displayName}` : "Pas encore connectée"}</p>
                    </div>
                    {shop ? (
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                        <Check className="size-4" /> Prête
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => setConnecting(id)}>
                        Connecter
                      </Button>
                    )}
                  </Card>
                )
              })}
            </div>
            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Retour
              </Button>
              <Button onClick={() => setStep(2)} variant={connected.length ? "primary" : "secondary"}>
                {connected.length ? "Continuer" : "Plus tard"} <ArrowRight />
              </Button>
            </div>
          </motion.section>
        )}

        {step === 2 && (
          <motion.section key={2} custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-sky/60 p-2">
                <Octopus className="w-14" label="" />
              </div>
              <div>
                <h1 className="text-title">{connected.length ? "C'est prêt." : "Presque prêt."} Que fait-on en premier ?</h1>
                <p className="text-body-muted mt-1">Tout se passe dans le chat. Choisissez une première mission, ou écrivez la vôtre.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-3">
              {missions.map((m, i) => (
                <motion.button
                  key={m.id}
                  type="button"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.12 + i * 0.08, duration: 0.4, ease: EASE } }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={leaving}
                  onClick={() => void finish(m.id)}
                  className="group flex items-center gap-4 rounded-xl border bg-card p-4 text-left transition-colors outline-none hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <m.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{m.title}</span>
                    <span className="block text-caption">{m.text}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </motion.button>
              ))}
            </div>
            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Retour
              </Button>
              <Button variant="secondary" onClick={() => void finish()} loading={leaving}>
                Ouvrir le chat
              </Button>
            </div>
          </motion.section>
        )}
        </AnimatePresence>
      </main>

      <ConnectMarketplaceModal
        open={!!connecting}
        onClose={() => setConnecting(null)}
        request={request}
        initialMarketplace={connecting}
        onConnected={() => void mutate()}
      />
    </div>
    </MotionConfig>
  )
}
