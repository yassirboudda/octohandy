import { currentUser } from "@clerk/nextjs/server"
import { DashboardShell } from "@/components/dashboard-shell"
import { PocWall, isPocAllowed, pocAccess } from "@/components/poc-wall"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null
  const access = pocAccess()
  if (!isPocAllowed(email, access)) {
    return <PocWall currentEmail={email} access={access} />
  }
  return <DashboardShell>{children}</DashboardShell>
}
