// Wrapper PostHog pour GoMytho.
// Activable en posant les variables d'env Vercel :
//   VITE_POSTHOG_KEY  = phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   VITE_POSTHOG_HOST = https://eu.i.posthog.com  (ou https://us.i.posthog.com)
//
// Si VITE_POSTHOG_KEY est absent (dev local non configuré),
// toutes les fonctions deviennent des no-op silencieux.

import posthog from 'posthog-js'

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com'

let initialized = false

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
      person_profiles: 'identified_only',
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
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      $pathname: window.location.pathname,
    })
  } catch { /* ignore */ }
}

export function captureEvent(name: string, props?: Record<string, unknown>): void {
  if (!initialized || !KEY) return
  try {
    posthog.capture(name, props)
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
