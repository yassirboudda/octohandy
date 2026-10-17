import Link from "next/link"
import { clerkAppearance } from "@/components/oh/clerk-appearance"
import { Octopus } from "@/components/oh/octopus"
import { SignUp } from "@clerk/nextjs"

export default function SignUpPage() {
  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-center gap-6 p-4">
      <Link href="/" className="flex items-center gap-2" aria-label="OctoHandy">
        <Octopus className="w-16" label="" />
        <span className="font-heading text-3xl text-foreground">OctoHandy</span>
      </Link>
      <SignUp
        appearance={clerkAppearance}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/onboarding"
        fallbackRedirectUrl="/onboarding"
      />
    </div>
  )
}
