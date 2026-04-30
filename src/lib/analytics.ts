// Wrapper PostHog pour GoMytho.
// Activable en posant les variables d'env Vercel :
//   VITE_POSTHOG_KEY  = phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   VITE_POSTHOG_HOST = https://eu.i.posthog.com  (ou https://us.i.posthog.com)
//
// Si VITE_POSTHOG_KEY est absent (dev local non configuré),
// toutes les fonctions deviennent des no-op silencieux.

import posthog from 'posthog-js'

const RAW_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const KEY = typeof RAW_KEY === 'string' ? RAW_KEY.trim() || undefined : undefined
const RAW_HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined
const HOST =
  (RAW_HOST?.trim() ?? '').replace(/\/$/, '') || 'https://eu.i.posthog.com'

/** Clic « vers Stripe » (Payment Link) — à chercher tel quel dans PostHog. */
export const EVENT_STRIPE_CHECKOUT_STARTED = 'stripe_checkout_started' as const

let initialized = false

// ─── Mapping pathname → nom lisible pour PostHog ──────────────────────────
// Avec ces noms, dans PostHog tu peux :
//   • Trends → group by "page_name"
//   • Funnels → étape "Pageview" filtrée sur page_name = "Upload Photo"
//   • Paths → savoir exactement où les users décrochent
const PAGE_NAMES: Array<{ pattern: RegExp; name: string; funnel_step?: number }> = [
  // Funnel public ITO (Initial Try-Out) — numérotation pour ordonner dans les rapports
  { pattern: /^\/$/, name: 'Landing', funnel_step: 1 },
  { pattern: /^\/uploadphoto/, name: 'Upload Photo', funnel_step: 2 },
  { pattern: /^\/chargementmytho/, name: 'Chargement Mytho', funnel_step: 3 },
  { pattern: /^\/choixoffre/, name: 'Choix Offre', funnel_step: 4 },
  { pattern: /^\/signup/, name: 'Signup', funnel_step: 5 },
  { pattern: /^\/login/, name: 'Login' },
  { pattern: /^\/auth\/callback/, name: 'Auth Callback' },

  // App interne (post-login) — funnel d'usage
  { pattern: /^\/resultats/, name: 'Mes Creations', funnel_step: 6 },
  { pattern: /^\/makemytho/, name: 'Creer un Mytho' },
  { pattern: /^\/settings/, name: 'Parametres' },

  // Admin (visible mais isolable via filtre page_name LIKE 'Admin:%')
  { pattern: /^\/admin-login/, name: 'Admin: Login' },
  { pattern: /^\/admin\/users/, name: 'Admin: Users' },
  { pattern: /^\/admin\/mythos/, name: 'Admin: Mythos' },
  { pattern: /^\/admin\/finance/, name: 'Admin: Finance' },
  { pattern: /^\/admin\/settings/, name: 'Admin: Settings' },
  { pattern: /^\/admin/, name: 'Admin: Dashboard' },
]

function resolvePage(pathname: string): { name: string; funnel_step?: number } {
  for (const entry of PAGE_NAMES) {
    if (entry.pattern.test(pathname)) {
      return { name: entry.name, funnel_step: entry.funnel_step }
    }
  }
  return { name: pathname || '/' }
}

export function initAnalytics(): void {
  if (initialized) return
  if (typeof window === 'undefined') return
  if (!KEY) {
    if (import.meta.env.DEV) {
      console.info('[analytics] PostHog désactivé (VITE_POSTHOG_KEY absent).')
    }
    return
  }

  try {
    posthog.init(KEY, {
      api_host: HOST,
      // On déclenche les pageviews manuellement depuis App.tsx pour bien gérer les SPA.
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: true, // clics, formulaires, sélecteurs
      persistence: 'localStorage+cookie',
      // `identified_only` peut masquer une partie du trafic anonyme selon la config
      // projet ; `always` garantit que chaque visiteur apparaît dans les rapports.
      person_profiles: 'always',
      loaded: (ph) => {
        if (import.meta.env.DEV) {
          ph.debug(true)
          console.info('[analytics] PostHog prêt (mode debug DEV).')
        }
      },
    })
    initialized = true
  } catch (err) {
    console.warn('[analytics] init échoué :', err)
  }
}

export function capturePageview(): void {
  if (!initialized || !KEY) return
  try {
    const pathname = window.location.pathname
    const { name, funnel_step } = resolvePage(pathname)

    // Met aussi à jour document.title pour avoir un breadcrumb propre dans
    // PostHog (la propriété auto $title est lue depuis là).
    if (typeof document !== 'undefined') {
      document.title = `GoMytho — ${name}`
    }

    posthog.capture(
      '$pageview',
      {
        $current_url: window.location.href,
        $pathname: pathname,
        page_name: name,
        ...(typeof funnel_step === 'number' ? { funnel_step } : {}),
      },
      { send_instantly: true },
    )
  } catch { /* ignore */ }
}

export function captureEvent(
  name: string,
  props?: Record<string, unknown>,
  options?: { send_instantly?: boolean },
): void {
  if (!initialized || !KEY) return
  try {
    posthog.capture(name, props, options)
  } catch { /* ignore */ }
}

export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (!initialized || !KEY) return
  try {
    posthog.identify(userId, traits)
  } catch { /* ignore */ }
}

export function resetAnalytics(): void {
  if (!initialized || !KEY) return
  try {
    posthog.reset()
  } catch { /* ignore */ }
}

export { posthog }
