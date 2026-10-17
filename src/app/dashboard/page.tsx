import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

// Chatbot-first: the dashboard home is the chat; new sellers go through onboarding once.
export default async function DashboardHome() {
  const user = await currentUser()
  redirect(user?.unsafeMetadata?.onboarded ? "/dashboard/chat" : "/onboarding")
}
