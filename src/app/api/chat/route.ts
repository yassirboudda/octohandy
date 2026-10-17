import { auth, currentUser } from "@clerk/nextjs/server"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"
import { z } from "zod"
import { isPocAllowed, pocAccess } from "@/components/poc-wall"

// Hermes runs actions on the desktop and can take a couple of minutes to answer.
export const maxDuration = 300

const API_UPSTREAM = (process.env.API_UPSTREAM_URL || "http://178.104.100.35").replace(/\/$/, "")

const nebius = createOpenAICompatible({
  name: "nebius",
  baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1",
  apiKey: process.env.NEBIUS_API_KEY,
})

const SYSTEM = `Tu es OctoHandy, l'assistant d'un vendeur sur les marketplaces (Vinted, eBay, Etsy, Facebook Marketplace).
Le vendeur n'est pas technique : réponds en français, en phrases courtes et simples, tutoie-le.
Le chat est la seule interface : quand une action a son outil, utilise l'outil au lieu d'expliquer où cliquer.

- Si le vendeur veut qu'OctoHandy apprenne une tâche, automatise quelque chose, ou montre comment il fait :
  pose d'abord une ou deux questions courtes pour savoir sur quelle marketplace et quelle tâche précise,
  puis appelle showRecordingSession. N'appelle pas l'outil tant que la tâche est floue.
- Pour voir ou gérer quelque chose, affiche la carte correspondante puis commente-la en une ou deux phrases :
  showWorkflows (ses automatisations), showShops (boutiques et annonces), showStock (stock),
  showDesktop (le bureau distant en direct), showTeam (équipe et invitations), showExtensionSetup (extension Chrome).
- Pour lancer un workflow : si tu ne connais pas encore son id, appelle d'abord showWorkflows, vérifie avec le
  vendeur lequel lancer, puis appelle runWorkflow avec son id. La carte gère le plan, la validation et la vidéo.
- Pour connecter une marketplace (Vinted, eBay, Etsy, Facebook Marketplace), appelle connectMarketplace.
- Pour les autres actions sur le bureau distant (agir dans Chrome, lire l'écran, créer un workflow à partir d'une
  consigne), appelle askDesktopAgent avec une consigne claire, puis résume sa réponse au vendeur.
- Si le vendeur envoie une photo d'article : décris ce que tu vois (type, marque si visible, état, couleur)
  et aide-le concrètement (titre d'annonce, description, fourchette de prix).`

export async function POST(req: Request) {
  const { userId, getToken } = await auth()
  if (!userId) return new Response("Unauthorized", { status: 401 })
  // Same gate as src/app/dashboard/layout.tsx: the agent acts on shops, so PoC access is required here too.
  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null
  if (!isPocAllowed(email, pocAccess()) && user?.publicMetadata?.stockflow_access !== true) {
    return new Response("Forbidden", { status: 403 })
  }
  if (!process.env.NEBIUS_API_KEY) return new Response("NEBIUS_API_KEY manquant côté serveur", { status: 500 })

  const { messages }: { messages: UIMessage[] } = await req.json()
  const token = await getToken()
  // Only the latest seller message keeps its photos: re-sending every earlier photo each turn would
  // grow the request toward Vercel's 4.5 MB body limit.
  const lastUser = messages.map((m) => m.role).lastIndexOf("user")
  const prepared = messages.map((m, i) => ({
    ...m,
    parts: m.parts.map((p) =>
      p.type === "file" && (i !== lastUser || !p.mediaType.startsWith("image/"))
        ? { type: "text" as const, text: "[image jointe]" }
        : p
    ),
  }))

  // Display tools fetch a short summary for the model; the chat card loads the full, live view itself.
  const api = async (path: string) => {
    const res = await fetch(`${API_UPSTREAM}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`)
    return res.json()
  }
  const noInput = z.object({})

  const result = streamText({
    model: nebius(process.env.NEBIUS_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash"),
    system: SYSTEM,
    // A card the seller ignored has no result yet; providers reject unanswered tool calls.
    messages: await convertToModelMessages(prepared, { ignoreIncompleteToolCalls: true }),
    // The model writes its answer in a second step, after a server tool returns.
    stopWhen: stepCountIs(5),
    tools: {
      // No execute: the chat renders the recording card and sends back what the seller did.
      showRecordingSession: {
        description:
          "Affiche dans le chat la session d'enregistrement : le bureau distant s'ouvre, le vendeur fait la tâche une fois, Screenpipe l'enregistre et OctoHandy en tire un workflow à valider.",
        inputSchema: z.object({
          marketplace: z.string().optional().describe("Marketplace concernée, en minuscules (vinted, ebay, etsy, facebook_marketplace), si connue"),
          task: z.string().describe("La tâche à apprendre, en une phrase simple"),
        }),
      },
      runWorkflow: {
        description:
          "Affiche la carte de lancement d'un workflow : OctoHandy prépare un plan, le vendeur valide les actions, puis l'exécution et la vidéo s'affichent.",
        inputSchema: z.object({ workflowId: z.string().describe("L'id du workflow, tel que renvoyé par showWorkflows") }),
      },
      connectMarketplace: {
        description: "Affiche la carte pour connecter une marketplace : le vendeur se connecte une fois dans le bureau distant.",
        inputSchema: z.object({
          marketplace: z.string().optional().describe("vinted, ebay, etsy ou facebook_marketplace, si connue"),
        }),
      },
      showWorkflows: {
        description: "Affiche les workflows du vendeur (activer, désactiver, lancer, en apprendre un nouveau).",
        inputSchema: noInput,
        execute: async () => {
          const { workflows } = (await api("/v1/workflows")) as {
            workflows: { id: string; title: string; marketplace: string; enabled: boolean }[]
          }
          return { workflows: workflows.map(({ id, title, marketplace, enabled }) => ({ id, title, marketplace, enabled })) }
        },
      },
      showShops: {
        description: "Affiche les boutiques connectées du vendeur et leurs annonces.",
        inputSchema: noInput,
        execute: async () => {
          const [{ shops }, { listings }] = (await Promise.all([api("/v1/shops"), api("/v1/listings")])) as [
            { shops: { displayName: string; marketplace: string; status: string; listingCount: number }[] },
            { listings: { title: string; price: number; status: string }[] },
          ]
          return {
            shops: shops.map(({ displayName, marketplace, status, listingCount }) => ({ displayName, marketplace, status, listingCount })),
            listings: listings.slice(0, 30).map(({ title, price, status }) => ({ title, price, status })),
          }
        },
      },
      showStock: {
        description: "Affiche le stock partagé (ajouter, modifier, supprimer des articles).",
        inputSchema: noInput,
        execute: async () => {
          const { items } = (await api("/v1/stock")) as { items: { title: string; qty: number; price?: number }[] }
          return { items: items.slice(0, 50).map(({ title, qty, price }) => ({ title, qty, price })) }
        },
      },
      showDesktop: {
        description: "Affiche le bureau distant OctoHandy : état, écran en direct, sessions et exécutions récentes.",
        inputSchema: noInput,
        execute: async () => {
          const { enabled, hermes, screenpipe, screen } = (await api("/v1/desktop/status")) as {
            enabled: boolean
            hermes: boolean
            screenpipe: { ok: boolean } | null
            screen: { window: string } | null
          }
          return { enabled, hermes, screenpipe: screenpipe?.ok ?? false, window: screen?.window ?? null }
        },
      },
      showTeam: {
        description: "Affiche l'équipe : profil de l'agent et liens d'invitation pour ajouter quelqu'un.",
        inputSchema: noInput,
        execute: async () => ({ shown: true }),
      },
      showExtensionSetup: {
        description: "Affiche l'installation de l'extension Chrome qui récupère les sessions Vinted/eBay du vendeur.",
        inputSchema: noInput,
        execute: async () => ({ shown: true }),
      },
      askDesktopAgent: {
        description:
          "Envoie une consigne à Hermes, l'agent qui pilote le bureau distant (lancer/créer un workflow, agir dans Chrome, lire l'écran). Renvoie sa réponse.",
        inputSchema: z.object({ request: z.string().describe("La consigne pour Hermes, en français") }),
        execute: async ({ request }) => {
          const res = await fetch(`${API_UPSTREAM}/v1/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ message: request }),
          })
          if (!res.ok) return { error: `Le bureau n'a pas répondu (HTTP ${res.status})` }
          const data = (await res.json()) as { content: string }
          return { reply: data.content }
        },
      },
    },
  })

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })
}
