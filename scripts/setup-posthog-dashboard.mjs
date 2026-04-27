#!/usr/bin/env node
/**
 * Crée le dashboard PostHog "GoMytho — Funnel ITO" en 1 commande.
 *
 * Pré-requis : 2 variables d'env
 *   POSTHOG_PERSONAL_API_KEY  → app.posthog.com → User → Personal API keys
 *                                (DIFFÉRENT de la clé phc_ utilisée par le SDK).
 *   POSTHOG_PROJECT_ID        → app.posthog.com → Project Settings → Project ID
 *                                (un nombre, ex: 12345)
 *
 * Optionnel :
 *   POSTHOG_HOST              → défaut https://eu.i.posthog.com
 *
 * Usage :
 *   POSTHOG_PERSONAL_API_KEY=phx_xxx POSTHOG_PROJECT_ID=12345 \
 *     node scripts/setup-posthog-dashboard.mjs
 */

const HOST = (process.env.POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '')
const KEY = process.env.POSTHOG_PERSONAL_API_KEY
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID

if (!KEY || !PROJECT_ID) {
  console.error('\n❌ Variables manquantes.\n')
  console.error('   POSTHOG_PERSONAL_API_KEY=<phx_xxx> POSTHOG_PROJECT_ID=<id> \\')
  console.error('     node scripts/setup-posthog-dashboard.mjs\n')
  console.error('   • Personal API key : app.posthog.com → user menu → Personal API keys')
  console.error('   • Project ID       : Project Settings → Project ID (un nombre)')
  console.error('   • POSTHOG_HOST     : https://eu.i.posthog.com (défaut) ou https://us.i.posthog.com\n')
  process.exit(1)
}

const BASE = `${HOST}/api/projects/${PROJECT_ID}`
const HEADERS = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

// ─── Funnel ITO : 6 étapes alignées avec page_name dans src/lib/analytics.ts ─
const FUNNEL_STEPS = [
  { step: 'Landing', name: 'Landing' },
  { step: 'Upload Photo', name: 'Upload Photo' },
  { step: 'Chargement Mytho', name: 'Chargement Mytho' },
  { step: 'Choix Offre', name: 'Choix Offre' },
  { step: 'Signup', name: 'Signup' },
  { step: 'Mes Creations', name: 'Mes Creations' },
]

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

async function createDashboard() {
  console.log('• Création du dashboard "GoMytho — Funnel ITO"…')
  const dash = await api('/dashboards/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'GoMytho — Funnel ITO',
      description:
        'Parcours public : Landing → Upload Photo → Chargement → Choix Offre → Signup → Mes Creations. ' +
        'Sources : événement $pageview filtré par page_name.',
      pinned: true,
    }),
  })
  console.log(`  → ✓ id=${dash.id}`)
  return dash
}

function pageviewFilter(pageName) {
  return {
    id: '$pageview',
    name: '$pageview',
    type: 'events',
    properties: [
      { key: 'page_name', value: pageName, operator: 'exact', type: 'event' },
    ],
  }
}

async function createFunnelInsight(dashId) {
  console.log('• Insight Funnel — drop-off par étape…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Funnel ITO — Drop-off par étape',
      description: 'Conversion étape par étape, du Landing à la 1ʳᵉ création visible.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'FunnelsQuery',
          dateRange: { date_from: '-30d' },
          interval: 'day',
          series: FUNNEL_STEPS.map((s) => ({
            kind: 'EventsNode',
            event: '$pageview',
            name: s.name,
            custom_name: s.name,
            properties: [
              { key: 'page_name', value: s.name, operator: 'exact', type: 'event' },
            ],
          })),
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

async function createTopPagesInsight(dashId) {
  console.log('• Insight Trends — pages les plus visitées (breakdown page_name)…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Pages les plus visitées',
      description: 'Volume de pageviews par page nommée, sur 30 jours.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          dateRange: { date_from: '-30d' },
          interval: 'day',
          series: [
            { kind: 'EventsNode', event: '$pageview', name: 'Pageview', math: 'total' },
          ],
          breakdownFilter: { breakdown_type: 'event', breakdown: 'page_name' },
          trendsFilter: { display: 'ActionsLineGraph' },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

async function createUniqueVisitorsInsight(dashId) {
  console.log('• Insight Trends — visiteurs uniques par jour…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Visiteurs uniques (DAU)',
      description: 'Nombre de visiteurs uniques par jour sur 30 jours.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          dateRange: { date_from: '-30d' },
          interval: 'day',
          series: [
            { kind: 'EventsNode', event: '$pageview', name: 'Visiteurs uniques', math: 'dau' },
          ],
          trendsFilter: { display: 'ActionsLineGraph' },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

async function createDropOffPerPageInsight(dashId) {
  console.log('• Insight Trends — sorties par page (last seen)…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Pages où les visiteurs s\'arrêtent (sorties)',
      description:
        "Nombre d'utilisateurs uniques dont la DERNIÈRE page vue est X. Approximé par " +
        '$pageview unique (DAU) breakdown page_name + filtre temporel récent.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          dateRange: { date_from: '-7d' },
          interval: 'day',
          series: [
            { kind: 'EventsNode', event: '$pageview', name: 'Visiteurs', math: 'dau' },
          ],
          breakdownFilter: { breakdown_type: 'event', breakdown: 'page_name' },
          trendsFilter: { display: 'ActionsBarValue' },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

async function createPathsInsight(dashId) {
  console.log('• Insight Paths — chemins suivis par les utilisateurs…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'User paths — où ils décrochent',
      description:
        'Diagramme Sankey des parcours réels : chaque "fin de branche" est ' +
        'une page où des utilisateurs se sont arrêtés.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'PathsQuery',
          dateRange: { date_from: '-30d' },
          pathsFilter: {
            includeEventTypes: ['$pageview'],
            stepLimit: 6,
          },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

async function createBouncePerStep(dashId) {
  console.log('• Insight Trends — pageviews par funnel_step…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Volume par étape du funnel ITO',
      description: 'Pageviews uniques (DAU) groupés par funnel_step (1=Landing … 6=Mes Creations).',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          dateRange: { date_from: '-30d' },
          interval: 'day',
          series: [
            { kind: 'EventsNode', event: '$pageview', name: 'Visiteurs', math: 'dau' },
          ],
          breakdownFilter: { breakdown_type: 'event', breakdown: 'funnel_step' },
          trendsFilter: { display: 'ActionsLineGraph' },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

async function main() {
  console.log(`\n🦔 PostHog setup — host=${HOST}  project=${PROJECT_ID}\n`)
  const dash = await createDashboard()
  // En séquence pour avoir des logs lisibles et éviter le throttling
  await createFunnelInsight(dash.id)
  await createTopPagesInsight(dash.id)
  await createDropOffPerPageInsight(dash.id)
  await createUniqueVisitorsInsight(dash.id)
  await createBouncePerStep(dash.id)
  await createPathsInsight(dash.id)

  const url = `${HOST}/project/${PROJECT_ID}/dashboard/${dash.id}`
  console.log(`\n✅ Dashboard prêt : ${url}\n`)
}

main().catch((err) => {
  console.error('\n❌ Échec :', err.message)
  process.exit(1)
})
