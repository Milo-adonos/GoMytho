import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'GoMytho - Mytho ta vie en 10 secondes',
  description: 'L\'IA qui transforme tes photos pour prank tes potes. Du poisson-bite à la Rolex, on couvre tout. Upload, prompt, mytho.',
  keywords: 'ia mytho photo, prank photo ia, ajouter rolex photo ia, modifier photo ia français, tiktok prank',
  openGraph: {
    title: 'GoMytho - Mytho ta vie en 10 secondes',
    description: 'Upload une photo, dis ce que tu veux ajouter, l\'IA fait le reste.',
    type: 'website',
    locale: 'fr_FR',
    siteName: 'GoMytho',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GoMytho - Mytho ta vie en 10 secondes',
    description: 'Upload une photo, dis ce que tu veux ajouter, l\'IA fait le reste.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className="scroll-smooth">
      <body className={`${inter.variable} font-sans antialiased bg-cream text-dark`}>
        {children}
      </body>
    </html>
  )
}
