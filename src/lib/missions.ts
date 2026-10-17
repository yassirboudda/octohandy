import { CONNECTABLE_MARKETPLACES, marketplaceName } from "@/components/connect-marketplace"

// Chat only auto-sends these fixed prompts from the URL (?mission=…&mp=…), never free text:
// a crafted link must not be able to make the agent act on a seller's shops.
const MISSIONS = {
  summary: (mp: string) => `Montre-moi un résumé de mes annonces ${mp}`,
  reply: (mp: string) => `Je veux apprendre à OctoHandy à répondre à mes acheteurs ${mp}`,
  publish: (mp: string) => `Aide-moi à publier un nouvel article sur ${mp}`,
}

export type MissionId = keyof typeof MISSIONS

export function missionHref(mission: MissionId, marketplace: string) {
  return `/dashboard/chat?mission=${mission}&mp=${encodeURIComponent(marketplace)}`
}

export function missionPrompt(params: URLSearchParams): string | null {
  const build = MISSIONS[params.get("mission") as MissionId]
  const mp = params.get("mp") ?? "vinted"
  if (!build || !CONNECTABLE_MARKETPLACES.some((m) => m.id === mp)) return null
  return build(marketplaceName(mp))
}
