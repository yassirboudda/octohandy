import { ClerkProvider } from "@clerk/nextjs"
import { frFR } from "@clerk/localizations"
import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google"
import { Toaster } from "sonner"
import "./globals.css"

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
})

export const metadata: Metadata = {
  title: "Stockflow — hackathon POV",
  description: "Chat, boutiques, stock partagé et workflows marketplace. Front POV sans backend.",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider localization={frFR}>
      <html lang="fr" className={`${jakarta.variable} ${jetbrainsMono.variable}`}>
        <body className="antialiased">
          {children}
          <Toaster richColors position="top-center" />
        </body>
      </html>
    </ClerkProvider>
  )
}
