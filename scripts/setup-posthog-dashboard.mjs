#!/usr/bin/env node
/**
 * Crée le dashboard PostHog "GoMytho — Pages" en 1 commande.
 *
 * Le dashboard est volontairement épuré :
 *   • Visites par page (toutes les pages nommées de gomytho.com)
 *   • Sorties par page (où les visiteurs quittent le site)
 *   • Visiteurs uniques par page (DAU)
 *   • Funnel public ITO étape par étape
 *
 * Pré-requis : 2 variables d'env
 *   POSTHOG_PERSONAL_API_KEY  → app.posthog.com → User → Personal API keys
 *   POSTHOG_PROJECT_ID        → Project Settings → Project ID
 *
 * Optionnel :
 *   POSTHOG_HOST                    → défaut https://eu.i.posthog.com
 *   POSTHOG_DASHBOARD_ID_TO_DELETE  → si fourni, supprime ce dashboard et ses
 *                                     insights AVANT de créer le nouveau.
 *                                     Utile pour repartir propre.
 *
 * Usage :
 *   POSTHOG_PERSONAL_API_KEY=phx_xxx POSTHOG_PROJECT_ID=12345 \
 *     node scripts/setup-posthog-dashboard.mjs
 */

const HOST = (process.env.POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '')
const KEY = process.env.POSTHOG_PERSONAL_API_KEY
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID
const DELETE_ID = process.env.POSTHOG_DASHBOARD_ID_TO_DELETE

if (!KEY || !PROJECT_ID) {
  console.error('\n❌ Variables manquantes.\n')
  console.error('   POSTHOG_PERSONAL_API_KEY=<phx_xxx> POSTHOG_PROJECT_ID=<id> \\')
  console.error('     node scripts/setup-posthog-dashboard.mjs\n')
  process.exit(1)
}

const BASE = `${HOST}/api/projects/${PROJECT_ID}`
const HEADERS = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

// ─── Pages nommées (ordre = funnel ITO) ────────────────────────────────────
const PAGES = [
  { name: 'Landing', step: 1 },
  { name: 'Upload Photo', step: 2 },
  { name: 'Chargement Mytho', step: 3 },
  { name: 'Choix Offre', step: 4 },
  { name: 'Signup', step: 5 },
  { name: 'Mes Creations', step: 6 },
  // App interne / hors funnel
  { name: 'Login' },
  { name: 'Auth Callback' },
  { name: 'Creer un Mytho' },
  { name: 'Parametres' },
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

// ─── Suppression de l'ancien dashboard si demandée ─────────────────────────
async function deleteDashboardIfRequested() {
  if (!DELETE_ID) return
  console.log(`• Archivage du dashboard #${DELETE_ID} (soft delete)…`)
  try {
    // PostHog n'autorise pas DELETE direct sur /dashboards/{id}/.
    // Le pattern officiel est PATCH { deleted: true, pinned: false }.
    await api(`/dashboards/${DELETE_ID}/`, {
      method: 'PATCH',
      body: JSON.stringify({ deleted: true, pinned: false }),
    })
    console.log('  → ✓ archivé')
  } catch (err) {
    console.warn(`  ⚠ impossible d'archiver (${err.message.slice(0, 120)}) — on continue.`)
  }
}

async function createDashboard() {
  console.log('• Création du dashboard "GoMytho — Pages"…')
  const dash = await api('/dashboards/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'GoMytho — Pages',
      description:
        'Dashboard simple : pour chaque page nommée du site (Landing, Upload Photo, ' +
        'Chargement Mytho, Choix Offre, Signup, Mes Creations…), nombre de visites ' +
        'et nombre de sorties (où les visiteurs quittent le site).',
      pinned: true,
    }),
  })
  console.log(`  → ✓ id=${dash.id}`)
  return dash
}

// ─── Insight 1 : Nombre de visites par page (toutes les pages nommées) ────
async function createVisitsByPage(dashId) {
  console.log('• Insight — Visites par page…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Visites par page',
      description: 'Nombre total de pageviews sur 30 jours, classé par page nommée.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          dateRange: { date_from: '-30d' },
          interval: 'day',
          series: [
            { kind: 'EventsNode', event: '$pageview', name: 'Visites', math: 'total' },
          ],
          breakdownFilter: { breakdown_type: 'event', breakdown: 'page_name' },
          // ActionsBarValue = barres horizontales = ranking clair par page
          trendsFilter: { display: 'ActionsBarValue' },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

// ─── Insight 2 : Visiteurs uniques par page (DAU) ─────────────────────────
async function createUniqueVisitorsByPage(dashId) {
  console.log('• Insight — Visiteurs uniques par page (DAU)…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Visiteurs uniques par page',
      description: 'Personnes différentes (DAU) ayant vu chaque page sur 30 jours.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'TrendsQuery',
          dateRange: { date_from: '-30d' },
          interval: 'day',
          series: [
            { kind: 'EventsNode', event: '$pageview', name: 'Personnes', math: 'dau' },
          ],
          breakdownFilter: { breakdown_type: 'event', breakdown: 'page_name' },
          trendsFilter: { display: 'ActionsBarValue' },
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

// ─── Insight 3 : Sorties par page (vraies "exit pages" via HogQL) ─────────
// On considère qu'une "sortie" est la DERNIÈRE page vue dans une session.
// HogQL nous laisse exprimer ça précisément.
async function createExitsByPage(dashId) {
  console.log('• Insight — Sorties par page (HogQL)…')
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Sorties par page',
      description:
        "Nombre de visiteurs dont la DERNIÈRE page vue dans la session est X. " +
        "Indique où les gens quittent réellement le site.",
      dashboards: [dashId],
      query: {
        kind: 'DataTableNode',
        source: {
          kind: 'HogQLQuery',
          query: `
            SELECT
              last_page AS page_name,
              count() AS sorties
            FROM (
              SELECT
                argMax(properties.page_name, timestamp) AS last_page,
                $session_id AS sid
              FROM events
              WHERE event = '$pageview'
                AND timestamp > now() - INTERVAL 30 DAY
                AND $session_id IS NOT NULL
                AND properties.page_name IS NOT NULL
              GROUP BY $session_id
            )
            GROUP BY page_name
            ORDER BY sorties DESC
          `.trim(),
        },
      },
    }),
  })
  console.log(`  → ✓ id=${insight.id}`)
}

// ─── Insight 4 : Funnel ITO 6 étapes ──────────────────────────────────────
async function createFunnelITO(dashId) {
  console.log('• Insight — Funnel ITO (6 étapes)…')
  const funnelPages = PAGES.filter((p) => typeof p.step === 'number').sort((a, b) => a.step - b.step)
  const insight = await api('/insights/', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Funnel ITO — du Landing à la 1ère création',
      description: 'Conversion à chaque étape : Landing → Upload Photo → Chargement → Choix Offre → Signup → Mes Creations.',
      dashboards: [dashId],
      query: {
        kind: 'InsightVizNode',
        source: {
          kind: 'FunnelsQuery',
          dateRange: { date_from: '-30d' },
          series: funnelPages.map((p) => ({
            kind: 'EventsNode',
            event: '$pageview',
            name: p.name,
            custom_name: p.name,
            properties: [
              { key: 'page_name', value: p.name, operator: 'exact', type: 'event' },
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

async function main() {
  console.log(`\n🦔 PostHog setup — host=${HOST}  project=${PROJECT_ID}\n`)
  await deleteDashboardIfRequested()
  const dash = await createDashboard()
  await createVisitsByPage(dash.id)
  await createUniqueVisitorsByPage(dash.id)
  await createExitsByPage(dash.id)
  await createFunnelITO(dash.id)
  const url = `${HOST}/project/${PROJECT_ID}/dashboard/${dash.id}`
  console.log(`\n✅ Dashboard prêt : ${url}\n`)
}

main().catch((err) => {
  console.error('\n❌ Échec :', err.message)
  process.exit(1)
})
