import { currentUser } from "@clerk/nextjs/server"
import { PocWall, isPocAllowed, pocAccess } from "@/components/poc-wall"

// Same access gate as the dashboard layout.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null
  const access = pocAccess()
  if (!isPocAllowed(email, access) && user?.publicMetadata?.stockflow_access !== true) {
    return <PocWall currentEmail={email} access={access} />
  }
  return children
}
