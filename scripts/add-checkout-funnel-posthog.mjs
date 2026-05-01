#!/usr/bin/env node
/**
 * Ajoute / met à jour les insights "Checkout" sur le dashboard GoMytho
 * existant : `checkout_started` (clic) et `checkout_opened` (la personne
 * arrive vraiment sur Stripe, signal envoyé pendant `pagehide` via
 * sendBeacon).
 *
 * Insights créés / remplacés :
 *   1. Funnel complet ITO + checkout (Landing → … → Choix Offre →
 *      checkout_started → checkout_opened → Paiement reussi → Signup →
 *      Mes Creations).
 *   2. Trend `checkout_started` vs `checkout_opened` (30j, breakdown
 *      par `plan` pour voir si l'écart vient de l'hebdo ou du mensuel).
 *
 * Si un insight portant le même nom existe déjà sur le dashboard, on le
 * supprime et on le recrée → pas d'effet doublon en relançant le script.
 *
 * Pré-requis :
 *   POSTHOG_PERSONAL_API_KEY  → app.posthog.com → User → Personal API keys
 *                               (scopes : insight:write, dashboard:read)
 *   POSTHOG_PROJECT_ID        → Project Settings → Project ID
 *
 * Optionnel :
 *   POSTHOG_DASHBOARD_NAME    → défaut "GoMytho — Pages"
 *   POSTHOG_DASHBOARD_ID      → court-circuite la recherche par nom
 *   POSTHOG_HOST              → défaut https://eu.i.posthog.com
 *
 * Usage :
 *   POSTHOG_PERSONAL_API_KEY=phx_xxx POSTHOG_PROJECT_ID=12345 \
 *     node scripts/add-checkout-funnel-posthog.mjs
 */

const HOST = (process.env.POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '')
const KEY = process.env.POSTHOG_PERSONAL_API_KEY
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID
const DASH_NAME = process.env.POSTHOG_DASHBOARD_NAME || 'GoMytho — Pages'
const DASH_ID_OVERRIDE = process.env.POSTHOG_DASHBOARD_ID

if (!KEY || !PROJECT_ID) {
  console.error('\n❌ Variables manquantes.\n')
  console.error('   POSTHOG_PERSONAL_API_KEY=<phx_xxx> POSTHOG_PROJECT_ID=<id> \\')
  console.error('     node scripts/add-checkout-funnel-posthog.mjs\n')
  process.exit(1)
}

const BASE = `${HOST}/api/projects/${PROJECT_ID}`
const HEADERS = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { _raw: text } }
  if (!res.ok) {
    throw new Error(`PostHog ${res.status} ${res.statusText} on ${path} → ${JSON.stringify(json).slice(0, 500)}`)
  }
  return json
}

// ─── Trouver le dashboard cible ────────────────────────────────────────────
async function findDashboard() {
  if (DASH_ID_OVERRIDE) {
    console.log(`• Dashboard fourni : id=${DASH_ID_OVERRIDE}`)
    return { id: Number(DASH_ID_OVERRIDE) }
  }
  console.log(`• Recherche du dashboard "${DASH_NAME}"…`)
  // PostHog pagine ; on accepte les 100 premiers résultats, largement suffisant.
  const list = await api(`/dashboards/?limit=100`)
  const items = Array.isArray(list?.results) ? list.results : []
  const match = items.find((d) => d.name === DASH_NAME && !d.deleted)
  if (!match) {
    throw new Error(
      `Dashboard "${DASH_NAME}" introuvable. Lance d'abord ` +
        `scripts/setup-posthog-dashboard.mjs ou passe POSTHOG_DASHBOARD_ID=<id>.`,
    )
  }
  console.log(`  → ✓ id=${match.id}`)
  return match
}

// ─── Si un insight du même nom existe déjà sur le dashboard, on le purge ──
//
// Note : combiner `?search=...&dashboards=...` provoque un HTTP 500 côté
// PostHog Cloud (au moins sur EU au 2026-04). On filtre donc côté client :
// on liste les insights du dashboard puis on matche le nom localement.
async function deleteInsightByName(dashId, name) {
  // PostHog Cloud renvoie un HTTP 500 quand on filtre /insights/ avec
  // ?dashboards=... ou ?search=... (au moins sur EU au 2026-04). On liste
  // donc tous les insights et on matche côté client par nom + dashboard.
  let url = `/insights/?limit=200`
  while (url) {
    const list = await api(url)
    const items = Array.isArray(list?.results) ? list.results : []
    const matches = items.filter(
      (it) =>
        it.name === name &&
        !it.deleted &&
        Array.isArray(it.dashboards) &&
        it.dashboards.includes(dashId),
    )
    for (const it of matches) {
      await api(`/insights/${it.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ deleted: true }),
      })
      console.log(`  → ✓ ancien insight "${name}" #${it.id} archivé`)
    }
    if (typeof list?.next === 'string' && list.next) {
      const u = new URL(list.next)
      url = u.pathname.replace(`/api/projects/${PROJECT_ID}`, '') + u.search
    } else {
      url = null
    }
  }
}

// ─── Insight 1 : Funnel complet ITO + checkout ─────────────────────────────
async function createFullFunnel(dashId) {
  const NAME = 'Funnel ITO + Checkout (complet)'
  console.log(`• Insight — ${NAME}…`)
  await deleteInsightByName(dashId, NAME)

  // page_name = filtre sur la propriété envoyée par capturePageview()
  const pageStep = (pageName, customName) => ({
    kind: 'EventsNode',
    event: '$pageview',
    name: pageName,
    custom_name: customName ?? pageName,
    properties: [
      { key: 'page_name', value: pageName, operator: 'exact', type: 'event' },
    ],
  })

  const eventStep = (eventName, customName) => ({
    kind: 'EventsNode',
    event: eventName,
    name: customName ?? eventName,
    custom_name: customName ?? eventName,
  })

  const series = [
    pageStep('Landing'),
    pageStep('Upload Photo'),
    pageStep('Chargement Mytho'),
    pageStep('Choix Offre'),
    eventStep('checkout_started', 'Clic sur Débloquer'),
    eventStep('checkout_opened', 'Stripe ouvert (pagehide)'),
    pageStep('Paiement reussi'),
    pageStep('Signup'),
    pageStep('Mes Creations'),
  ]

  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: NAME,
      description:
        'Funnel public complet : du Landing à la 1ère création, en passant ' +
        'par les events Stripe (checkout_started = clic, checkout_opened = ' +
        'redirection vers Stripe effective). Permet de voir précisément où ' +
        'les gens décrochent côté paiement.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'FunnelsQuery',
          dateRange: { date_from: '-30d' },
          series,
          funnelsFilter: {
            funnelVizType: 'steps',
            funnelOrderType: 'ordered',
            funnelWindowInterval: 14,
            funnelWindowIntervalUnit: 'day',
          },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

// ─── Insight 2 : Trend started vs opened, breakdown par plan ──────────────
async function createCheckoutTrend(dashId) {
  const NAME = 'Checkout — started vs opened (par plan)'
  console.log(`• Insight — ${NAME}…`)
  await deleteInsightByName(dashId, NAME)

  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: NAME,
      description:
        'Sur 30 jours : nombre de checkout_started (clic) vs checkout_opened ' +
        '(arrivée réelle sur Stripe), breakdown par plan (weekly / monthly). ' +
        'L\'écart entre les deux = pertes au moment du redirect.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          dateRange: { date_from: '-30d' },
          interval: 'day',
          series: [
            { kind: 'EventsNode', event: 'checkout_started', name: 'checkout_started', math: 'total' },
            { kind: 'EventsNode', event: 'checkout_opened', name: 'checkout_opened', math: 'total' },
          ],
          breakdownFilter: { breakdown_type: 'event', breakdown: 'plan' },
          trendsFilter: { display: 'ActionsLineGraph' },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

async function main() {
  console.log(`\n🦔 PostHog : ajout des insights checkout — host=${HOST}  project=${PROJECT_ID}\n`)
  const dash = await findDashboard()
  await createFullFunnel(dash.id)
  await createCheckoutTrend(dash.id)
  const url = `${HOST}/project/${PROJECT_ID}/dashboard/${dash.id}`
  console.log(`\n✅ Dashboard mis à jour : ${url}\n`)
}

main().catch((err) => {
  console.error('\n❌ Échec :', err.message)
  process.exit(1)
})
