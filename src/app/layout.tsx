import { ClerkProvider } from "@clerk/nextjs"
import { frFR } from "@clerk/localizations"
import type { Metadata, Viewport } from "next"
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"
import "./oh.css"

// Variable Fraunces with its SOFT/WONK axes: the rounded "soft" cut echoes the octopus drawing.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
})

export const metadata: Metadata = {
  title: "OctoHandy — Gestion marketplace",
  description: "Gère tes boutiques, annonces et stock partagé avec l'agent OctoHandy.",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#FFFCF3",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      localization={frFR}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
      // Clerk prod domain is clerk.amirelay.com. Do NOT set proxyUrl to the FAPI host.
    >
      <html lang="fr" className={`${jetbrainsMono.variable} ${fraunces.variable} ${hanken.variable}`}>
        <body className="antialiased">
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-center" />
        </body>
      </html>
    </ClerkProvider>
  )
}
