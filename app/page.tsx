'use client'

import Hero from '@/components/Hero'
import UseCases from '@/components/UseCases'
import HowItWorks from '@/components/HowItWorks'
import WhyGoMytho from '@/components/WhyGoMytho'
import Pricing from '@/components/Pricing'
import FAQ from '@/components/FAQ'
import FinalCTA from '@/components/FinalCTA'

export default function Home() {
  return (
    <main className="min-h-screen">
      <Hero />
      <UseCases />
      <HowItWorks />
      <WhyGoMytho />
      <Pricing />
      <FAQ />
      <FinalCTA />
    </main>
  )
}
