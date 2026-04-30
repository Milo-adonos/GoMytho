import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac, timingSafeEqual, createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mappe un id de manifeste arbitraire vers un UUID stable et déterministe
// (cf. api/mythos-sync.ts pour les détails). Permet au backfill de réussir
// l'insert dans public.mythos.id (typé UUID).
function localIdToUuid(localId: string): string {
  if (UUID_REGEX.test(localId)) return localId
  const hash = createHash('sha1').update(localId).digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const WEEKLY_PRICE = 2.99
const MONTHLY_PRICE = 9.90
const COST_PER_IMAGE = 0.037
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_gomytho_2026'

/**
 * Baseline du panel admin : agrégats et listes n’incluent que les données à
 * partir du 30 avril 2026 minuit (Europe/Paris). Le 29 et avant = ignorés.
 */
const ADMIN_STATS_EPOCH_ISO = '2026-04-30T00:00:00+02:00'
const ADMIN_STATS_EPOCH_MS = new Date(ADMIN_STATS_EPOCH_ISO).getTime()

/**
 * Baseline annulations (churn). Toute annulation Stripe dont `canceled_at`
 * est antérieur à cette date est IGNORÉE par le panel admin (cancelledAllTime,
 * cancelledLast30d, churnRate, churnCount, totalSubscribersAllTime).
 *
 * Pourquoi : avant cette date, des annulations / suppressions ont été faites
 * manuellement sur Stripe (ménage de tests, retraits de gratuités, etc.).
 * Elles ne reflètent pas un vrai churn business → on les neutralise pour
 * repartir d'une base propre. Tout abandon FUTUR sera compté normalement.
 */
const ADMIN_CHURN_EPOCH_ISO = '2026-04-30T17:00:00+02:00'
const ADMIN_CHURN_EPOCH_MS = new Date(ADMIN_CHURN_EPOCH_ISO).getTime()

function stripeCreatedOnOrAfterEpoch(tsSeconds: number): boolean {
  return tsSeconds * 1000 >= ADMIN_STATS_EPOCH_MS
}

function cancellationOnOrAfterChurnEpoch(canceledAtSec: number | null | undefined): boolean {
  if (!canceledAtSec) return false
  return canceledAtSec * 1000 >= ADMIN_CHURN_EPOCH_MS
}

function mythoOnOrAfterEpoch(iso: string): boolean {
  const t = new Date(iso).getTime()
  return !Number.isNaN(t) && t >= ADMIN_STATS_EPOCH_MS
}

const HEBDO_PRICE_ID = process.env.HEBDO_PRICE_ID || ''
const MENSU_PRICE_ID = process.env.MENSU_PRICE_ID || ''

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return null
  return new Stripe(secret)
}

function normEmail(e: string | null | undefined): string {
  return String(e || '').trim().toLowerCase()
}

function isPanelExcludedEmail(email: string | null | undefined, excluded: Set<string>): boolean {
  const n = normEmail(email)
  return n.length > 0 && excluded.has(n)
}

async function fetchPanelExclusions(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
): Promise<{ emails: Set<string>; ids: Set<string> }> {
  const emails = new Set<string>()
  const ids = new Set<string>()
  try {
    const { data, error } = await supabase.from('admin_panel_exclusions').select('email_norm, user_id')
    if (error) {
      if ((error as any).code === 'PGRST116' || /does not exist|404/.test(error.message || '')) return { emails, ids }
      console.warn('[admin] exclusions read:', error.message)
      return { emails, ids }
    }
    for (const row of data as any[]) {
      if (row.email_norm) emails.add(normEmail(row.email_norm))
      if (row.user_id) ids.add(String(row.user_id))
    }
  } catch {
    /* table absente en local */
  }
  return { emails, ids }
}

/** Exclusions panel manuelles + inscriptions public.users strictement avant le baseline stats (30 avr. 2026 Paris). */
async function getAdminPanelExclusionContext(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
): Promise<{ userIds: Set<string>; emails: Set<string> }> {
  const { emails: panelEmails, ids: panelIds } = await fetchPanelExclusions(supabase)
  const userIds = new Set<string>(panelIds)
  const emails = new Set<string>(panelEmails)

  const epochIso = new Date(ADMIN_STATS_EPOCH_MS).toISOString()
  const { data: preEpochRows, error: preErr } = await supabase
    .from('users')
    .select('id, email')
    .lt('created_at', epochIso)
  if (preErr) {
    if (!/does not exist|schema cache/i.test(preErr.message || '')) {
      console.warn('[admin] pre-epoch users:', preErr.message)
    }
  } else {
    for (const u of preEpochRows || []) {
      userIds.add(String((u as any).id))
      const em = normEmail((u as any).email)
      if (em) emails.add(em)
    }
  }

  if (panelEmails.size > 0) {
    const { data: rows } = await supabase.from('users').select('id, email')
    for (const u of rows || []) {
      const id = String((u as any).id)
      const em = normEmail((u as any).email)
      if (em && panelEmails.has(em)) userIds.add(id)
    }
  }

  return { userIds, emails }
}

function subscriptionCustomerEmail(sub: Stripe.Subscription): string | null {
  const c = sub.customer
  if (typeof c === 'string') return null
  return (c as Stripe.Customer)?.email || null
}

function subscriptionCustomerId(sub: Stripe.Subscription): string | null {
  const c = sub.customer
  if (typeof c === 'string') return c
  return (c as Stripe.Customer)?.id || null
}

function invoiceStripeCustomerId(inv: Stripe.Invoice): string | null {
  const c = inv.customer
  if (typeof c === 'string') return c || null
  if (c && typeof c === 'object' && 'deleted' in c && (c as { deleted?: boolean }).deleted) return null
  if (c && typeof c === 'object' && 'id' in c) return String((c as { id?: string }).id || '') || null
  return null
}

/** Abonnements Stripe dont la première souscription connue (ligne courante) est antérieure au baseline panel. */
function preEpochStripeCustomerIdsFromSubs(subs: Stripe.Subscription[]): Set<string> {
  const out = new Set<string>()
  for (const sub of subs) {
    if (stripeCreatedOnOrAfterEpoch(sub.created)) continue
    const id = subscriptionCustomerId(sub)
    if (id) out.add(id)
  }
  return out
}

// ─── Source de vérité Stripe : abonnements + paiements ───────────────────────
//
// On interroge directement Stripe pour le CA, le nombre d'abonnés et le
// nombre de nouveaux abonnés. Ainsi, dès qu'un paiement passe sur Stripe,
// les chiffres apparaissent dans le panel — même si le user n'a pas encore
// terminé sa création de compte côté Supabase.
type StripeStats = {
  totalRevenueAllTime: number
  revenue30d: number
  revenuePrev30d: number
  activeSubscribers: number
  weeklySubscribers: number
  monthlySubscribers: number
  newSubscribers30d: number
  newSubscribersPrev30d: number
  cancelledLast30d: number
  cancelledAllTime: number
  totalSubscribersAllTime: number
  dailyRevenue: Record<string, number>  // YYYY-MM-DD -> €
  subscriptions: Array<{
    customerId: string
    email: string | null
    plan: 'weekly' | 'monthly' | 'unknown'
    status: string
    createdAt: number
  }>
}

function planFromPriceId(priceId: string | undefined | null): 'weekly' | 'monthly' | 'unknown' {
  if (!priceId) return 'unknown'
  if (priceId === HEBDO_PRICE_ID) return 'weekly'
  if (priceId === MENSU_PRICE_ID) return 'monthly'
  return 'unknown'
}

async function fetchStripeStats(stripe: Stripe, panelExcludedEmails?: Set<string>): Promise<StripeStats> {
  const exc = panelExcludedEmails && panelExcludedEmails.size > 0 ? panelExcludedEmails : null
  const skipEmail = (e: string | null | undefined) => (exc ? isPanelExcludedEmail(e, exc) : false)

  const now = Math.floor(Date.now() / 1000)
  const thirtyDaysAgo = now - 30 * 86400
  const sixtyDaysAgo = now - 60 * 86400

  // Subscriptions actives + canceled (pour le churn) — on remonte 200 max
  const [activeSubs, canceledSubs] = await Promise.all([
    stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] }),
    stripe.subscriptions.list({ status: 'canceled', limit: 100, expand: ['data.customer'] }),
  ])

  const preEpochStripeCustomerIds = preEpochStripeCustomerIdsFromSubs([
    ...activeSubs.data,
    ...canceledSubs.data,
  ])

  // Liste des paiements (invoices) des 60 derniers jours pour calculer CA
  const invoices: Stripe.Invoice[] = []
  let starting_after: string | undefined = undefined
  // Invoices : fenêtre 60 j, mais jamais avant la baseline stats admin
  const invoiceListGte = Math.max(sixtyDaysAgo, Math.floor(ADMIN_STATS_EPOCH_MS / 1000))
  for (let i = 0; i < 5; i++) {
    const page: Stripe.ApiList<Stripe.Invoice> = await stripe.invoices.list({
      status: 'paid',
      created: { gte: invoiceListGte },
      limit: 100,
      ...(starting_after ? { starting_after } : {}),
    })
    invoices.push(...page.data)
    if (!page.has_more) break
    starting_after = page.data[page.data.length - 1]?.id
  }

  // ─── Set des clients « valides » pour le CA ──────────────────────────────
  // On ne compte que les invoices dont le client est :
  //   • soit actuellement actif,
  //   • soit annulé APRÈS la baseline churn (= vrai désabonnement business).
  // Exclut donc les clients que tu as supprimés/désabonnés manuellement
  // avant la baseline → leur CA passé n'est plus compté.
  const validRevenueCustomerIds = new Set<string>()
  for (const sub of activeSubs.data) {
    if (!stripeCreatedOnOrAfterEpoch(sub.created)) continue
    if (skipEmail(subscriptionCustomerEmail(sub))) continue
    const cid = subscriptionCustomerId(sub)
    if (cid) validRevenueCustomerIds.add(cid)
  }
  for (const sub of canceledSubs.data) {
    if (!stripeCreatedOnOrAfterEpoch(sub.created)) continue
    if (skipEmail(subscriptionCustomerEmail(sub))) continue
    if (!cancellationOnOrAfterChurnEpoch(sub.canceled_at || 0)) continue
    const cid = subscriptionCustomerId(sub)
    if (cid) validRevenueCustomerIds.add(cid)
  }

  const isInvoiceCounted = (inv: Stripe.Invoice): boolean => {
    if (!stripeCreatedOnOrAfterEpoch(inv.created)) return false
    const invCust = invoiceStripeCustomerId(inv)
    if (invCust && preEpochStripeCustomerIds.has(invCust)) return false
    if (skipEmail(inv.customer_email || null)) return false
    if (!invCust || !validRevenueCustomerIds.has(invCust)) return false
    return true
  }

  const dailyRevenue: Record<string, number> = {}
  let revenue30d = 0
  let revenuePrev30d = 0
  for (const inv of invoices) {
    if (!isInvoiceCounted(inv)) continue
    const ts = inv.created
    const amount = (inv.amount_paid || 0) / 100
    if (ts >= thirtyDaysAgo) revenue30d += amount
    else if (ts >= sixtyDaysAgo) revenuePrev30d += amount
    const day = new Date(ts * 1000).toISOString().split('T')[0]
    dailyRevenue[day] = (dailyRevenue[day] || 0) + amount
  }

  // CA cumulé (uniquement clients valides → restart propre)
  const totalRevenueAllTime = invoices.reduce(
    (acc, inv) => (isInvoiceCounted(inv) ? acc + (inv.amount_paid || 0) / 100 : acc),
    0,
  )

  let weeklySubscribers = 0
  let monthlySubscribers = 0
  let newSubscribers30d = 0
  let newSubscribersPrev30d = 0
  const subscriptions: StripeStats['subscriptions'] = []

  for (const sub of activeSubs.data) {
    if (!stripeCreatedOnOrAfterEpoch(sub.created)) continue
    if (skipEmail(subscriptionCustomerEmail(sub))) continue
    const priceId = sub.items?.data?.[0]?.price?.id
    const plan = planFromPriceId(priceId)
    if (plan === 'weekly') weeklySubscribers++
    else if (plan === 'monthly') monthlySubscribers++

    if (sub.created >= thirtyDaysAgo) newSubscribers30d++
    else if (sub.created >= sixtyDaysAgo) newSubscribersPrev30d++

    const customer = sub.customer
    const email = typeof customer === 'string'
      ? null
      : (customer as Stripe.Customer)?.email || null
    const customerId = typeof customer === 'string' ? customer : (customer as Stripe.Customer)?.id || ''

    subscriptions.push({
      customerId,
      email,
      plan,
      status: sub.status,
      createdAt: sub.created * 1000,
    })
  }

  let cancelledLast30d = 0
  for (const sub of canceledSubs.data) {
    if (!stripeCreatedOnOrAfterEpoch(sub.created)) continue
    if (skipEmail(subscriptionCustomerEmail(sub))) continue
    const cat = sub.canceled_at || 0
    // Filtre baseline churn : on ignore tout désabonnement antérieur au
    // « repart de zéro » (cf. ADMIN_CHURN_EPOCH_ISO).
    if (!cancellationOnOrAfterChurnEpoch(cat)) continue
    if (cat >= thirtyDaysAgo) cancelledLast30d++
  }

  const activeSubscribers = weeklySubscribers + monthlySubscribers
  const cancelledAllTime = canceledSubs.data.filter((s) =>
    stripeCreatedOnOrAfterEpoch(s.created) &&
    !skipEmail(subscriptionCustomerEmail(s)) &&
    cancellationOnOrAfterChurnEpoch(s.canceled_at || 0),
  ).length
  const totalSubscribersAllTime = activeSubscribers + cancelledAllTime

  return {
    totalRevenueAllTime,
    revenue30d,
    revenuePrev30d,
    activeSubscribers,
    weeklySubscribers,
    monthlySubscribers,
    newSubscribers30d,
    newSubscribersPrev30d,
    cancelledLast30d,
    cancelledAllTime,
    totalSubscribersAllTime,
    dailyRevenue,
    subscriptions: subscriptions.filter((s) => s.createdAt >= ADMIN_STATS_EPOCH_MS),
  }
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function signPayload(payload: string): string {
  return createHmac('sha256', JWT_SECRET).update(payload).digest('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function verifyAdmin(req: VercelRequest): boolean {
  try {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies.admin_token
    if (!token) return false
    const [payloadB64, signature] = token.split('.')
    if (!payloadB64 || !signature) return false
    const expected = signPayload(payloadB64)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    if (!timingSafeEqual(a, b)) return false
    const data = JSON.parse(fromBase64url(payloadB64).toString('utf8'))
    return data?.role === 'admin' && typeof data.exp === 'number' && Date.now() < data.exp
  } catch {
    return false
  }
}

function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!verifyAdmin(req)) {
    res.status(401).json({ error: 'Non autorisé' })
    return false
  }
  return true
}

/** Segment dynamique /api/admin/:action (Vercel met souvent req.query.action, repli sur l’URL si besoin). */
function getAdminAction(req: VercelRequest): string {
  const raw = req.query.action
  const fromQuery = Array.isArray(raw) ? raw[0] : raw
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim().toLowerCase()
  const url = String(req.url || '')
  const path = url.split('?')[0]
  const segments = path.split('/').filter(Boolean)
  if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'admin') {
    const seg = segments[2]
    if (seg && seg !== 'admin') return decodeURIComponent(seg).toLowerCase()
  }
  return ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return

  const action = getAdminAction(req)

  try {
    switch (action) {
      case 'dashboard': return await handleDashboard(res)
      case 'finance': return await handleFinance(res)
      case 'mythos': return await handleMythos(req, res)
      case 'users': return await handleUsers(req, res)
      case 'settings': return await handleSettings(req, res)
      case 'migrate': return await handleMigrate(res)
      case 'purge-stats-epoch': {
        if (req.method !== 'POST') {
          res.status(405).json({ error: 'POST requis' })
          return
        }
        return await handlePurgeStatsEpoch(res)
      }
      case 'exclusions':
        return await handlePanelExclusions(req, res)
      default:
        return res.status(404).json({ error: 'Action inconnue' })
    }
  } catch (e: any) {
    console.error(`[admin/${action}] error`, e?.message || e)
    return res.status(200).json(emptyForAction(action))
  }
}

function emptyForAction(action: string) {
  switch (action) {
    case 'dashboard': return buildEmptyDashboard()
    case 'finance': return buildEmptyFinance()
    case 'mythos': return { mythos: [], total: 0 }
    case 'users': return { users: [], total: 0 }
    case 'settings': return { costPerImage: COST_PER_IMAGE, maintenanceMode: false, notificationEmail: '' }
    case 'purge-stats-epoch': return { ok: false }
    case 'exclusions': return { exclusions: [] }
    default: return {}
  }
}

async function handleDashboard(res: VercelResponse) {
  const supabase = getSupabase()
  const stripe = getStripe()

  // ─── Récupération parallèle Stripe + Supabase ──────────────────────────────
  // Stripe = source de vérité pour CA + abonnés (paiement réel)
  // Supabase = source pour les analyses générées :
  //   - on lit la table SQL public.mythos (rapide, indexée)
  //   - ET on lit les manifests Storage en fallback / source authoritative,
  //     car certaines créations historiques n'ont pas été mirrorées en SQL
  //     (bug d'UUID dans mirrorInsertSql, corrigé). Si Storage > SQL, on
  //     déclenche aussi un backfill automatique pour synchroniser.
  const now = new Date()
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30)

  const panelCtx = supabase ? await getAdminPanelExclusionContext(supabase) : { userIds: new Set<string>(), emails: new Set<string>() }

  const mythosSqlPromise = (async () => {
    if (!supabase) return { data: [] as any[] }
    let q = supabase
      .from('mythos')
      .select('id, created_at, user_id')
      .gte('created_at', new Date(ADMIN_STATS_EPOCH_MS).toISOString())
    if (panelCtx.userIds.size > 0) {
      q = q.not('user_id', 'in', `(${Array.from(panelCtx.userIds).join(',')})`)
    }
    return q
  })()

  const [stripeStats, mythosData, storageMythos] = await Promise.all([
    stripe ? fetchStripeStats(stripe, panelCtx.emails).catch((e) => {
      console.error('[admin/dashboard] stripe error:', e?.message || e)
      return null
    }) : Promise.resolve(null),
    mythosSqlPromise,
    supabase ? collectMythosFromStorage(supabase, panelCtx.userIds).catch((e) => {
      console.error('[admin/dashboard] storage scan error:', e?.message || e)
      return [] as Array<{ id: string; user_id: string; created_at: string; image_path: string; prompt: string }>
    }) : Promise.resolve([]),
  ])

  const sqlMythos = (mythosData as any)?.data || []

  // On fusionne SQL + Storage par UUID dérivé. Storage est plus authoritative
  // côté front (c'est là que les mythos sont écrits en premier), SQL ne sert
  // qu'au panel admin. La fusion garantit qu'on ne sous-compte jamais.
  const sqlIds = new Set<string>(sqlMythos.map((m: any) => String(m.id)))
  const merged: Array<{ id: string; created_at: string }> = sqlMythos.map((m: any) => ({
    id: String(m.id),
    created_at: String(m.created_at || ''),
  }))
  let storageOnlyCount = 0
  for (const e of storageMythos) {
    if (panelCtx.userIds.has(e.user_id)) continue
    if (!mythoOnOrAfterEpoch(e.created_at)) continue
    const sqlId = localIdToUuid(e.id)
    if (sqlIds.has(sqlId)) continue
    merged.push({ id: sqlId, created_at: e.created_at })
    storageOnlyCount++
  }

  const allMythos = merged
  const totalMythos = allMythos.length
  const totalCost = totalMythos * COST_PER_IMAGE

  // ─── Backfill silencieux : si Storage est en avance sur SQL, on rattrape
  // l'écart en arrière-plan pour les prochains appels (idempotent grâce à
  // l'UUID déterministe). On ne bloque pas la réponse.
  if (supabase && storageOnlyCount > 0) {
    const toBackfill = storageMythos.filter((e) => !panelCtx.userIds.has(e.user_id))
    void backfillMythosToSql(supabase, toBackfill).catch(() => { /* silent */ })
  }

  // Si Stripe est dispo on s'en sert, sinon on tombe à 0 (mais structure complète)
  const totalRevenue = stripeStats?.totalRevenueAllTime ?? 0
  const revenue30d = stripeStats?.revenue30d ?? 0
  const prevRevenue30d = stripeStats?.revenuePrev30d ?? 0
  const revenueGrowth = prevRevenue30d > 0
    ? ((revenue30d - prevRevenue30d) / prevRevenue30d) * 100
    : (revenue30d > 0 ? 100 : 0)

  const newSub30d = stripeStats?.newSubscribers30d ?? 0
  const newSubPrev30d = stripeStats?.newSubscribersPrev30d ?? 0
  const newSubGrowth = newSubPrev30d > 0
    ? ((newSub30d - newSubPrev30d) / newSubPrev30d) * 100
    : (newSub30d > 0 ? 100 : 0)

  const netProfit = totalRevenue - totalCost
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  const totalActive = (stripeStats?.activeSubscribers ?? 0) + (stripeStats?.cancelledLast30d ?? 0)
  const churnRate = totalActive > 0 ? ((stripeStats?.cancelledLast30d ?? 0) / totalActive) * 100 : 0

  // Histogramme journalier 30 jours (revenus Stripe + analyses Supabase)
  const dailyMap: Record<string, { revenue: number; mythos: number }> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i)
    dailyMap[d.toISOString().split('T')[0]] = { revenue: 0, mythos: 0 }
  }
  if (stripeStats) {
    for (const [day, rev] of Object.entries(stripeStats.dailyRevenue)) {
      if (dailyMap[day] !== undefined) dailyMap[day].revenue = +rev.toFixed(2)
    }
  }
  for (const m of allMythos) {
    const day = String(m.created_at || '').split('T')[0]
    if (day && dailyMap[day] !== undefined) dailyMap[day].mythos += 1
  }
  const dailyChartData = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v }))

  // Filtrer les mythos sur les 30 derniers jours pour stat
  const thirtyDaysAgoMs = thirtyDaysAgo.getTime()
  const mythosWindowStart = Math.max(thirtyDaysAgoMs, ADMIN_STATS_EPOCH_MS)
  const mythos30dCount = allMythos.filter(
    (m: any) => new Date(m.created_at).getTime() >= mythosWindowStart,
  ).length

  return res.status(200).json({
    totalRevenue: +totalRevenue.toFixed(2),
    revenue30d: +revenue30d.toFixed(2),
    revenueGrowth: +revenueGrowth.toFixed(1),
    totalCost: +totalCost.toFixed(2),
    totalMythos,
    mythos30d: mythos30dCount,
    netProfit: +netProfit.toFixed(2),
    margin: +margin.toFixed(1),
    activeSubscribers: stripeStats?.activeSubscribers ?? 0,
    weeklySubscribers: stripeStats?.weeklySubscribers ?? 0,
    monthlySubscribers: stripeStats?.monthlySubscribers ?? 0,
    totalSubscribersAllTime: stripeStats?.totalSubscribersAllTime ?? 0,
    cancelledAllTime: stripeStats?.cancelledAllTime ?? 0,
    newSubscribers30d: newSub30d,
    newSubscribersGrowth: +newSubGrowth.toFixed(1),
    churnRate: +churnRate.toFixed(1),
    churnCount: stripeStats?.cancelledLast30d ?? 0,
    dailyRevenue: dailyChartData,
    dailyMythos: dailyChartData,
    stripeAvailable: !!stripeStats,
  })
}

// ─── Collecte tous les mythos historiques depuis Supabase Storage ───────────
//
// Lit les manifestes {uid}/index.json du bucket et renvoie une liste plate
// des entrées. Sert :
//   1. Au comptage exact des analyses (le mirror SQL a pu rater des inserts).
//   2. Au backfill automatique vers public.mythos.
//
// Performance : 1 list + 1 download par utilisateur. Acceptable jusqu'à
// quelques centaines d'utilisateurs (au-delà, mettre en cache via KV/Redis).
async function collectMythosFromStorage(
  supabase: ReturnType<typeof createClient>,
  excludedUserIds: Set<string>,
): Promise<Array<{ id: string; user_id: string; created_at: string; image_path: string; prompt: string }>> {
  const bucket = String(process.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'
  const { data: folders, error } = await supabase.storage.from(bucket).list('', { limit: 1000 })
  if (error || !folders) return []

  const out: Array<{ id: string; user_id: string; created_at: string; image_path: string; prompt: string }> = []
  await Promise.all(
    folders.map(async (folder) => {
      if (!folder.name || folder.name.includes('.')) return
      const uid = folder.name
      if (excludedUserIds.has(uid)) return
      try {
        const { data: blob } = await supabase.storage.from(bucket).download(`${uid}/index.json`)
        if (!blob) return
        const manifest = JSON.parse(await blob.text())
        const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
        for (const entry of entries) {
          if (!entry?.id || !entry?.image_path || !entry?.prompt) continue
          const created = String(entry.created_at || new Date().toISOString())
          if (!mythoOnOrAfterEpoch(created)) continue
          out.push({
            id: String(entry.id),
            user_id: uid,
            created_at: created,
            image_path: String(entry.image_path),
            prompt: String(entry.prompt),
          })
        }
      } catch {
        /* manifest illisible → on ignore ce user */
      }
    })
  )
  return out
}

// ─── Backfill vers public.mythos ────────────────────────────────────────────
// Idempotent : utilise localIdToUuid pour générer le même PK à chaque appel,
// donc les upserts ne créent jamais de doublons.
async function backfillMythosToSql(
  supabase: ReturnType<typeof createClient>,
  entries: Array<{ id: string; user_id: string; created_at: string; image_path: string; prompt: string }>,
): Promise<void> {
  const bucket = String(process.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'
  const SIGNED_URL_TTL = 60 * 60 * 24 * 365  // 1 an

  // Filtre les entrées dont l'utilisateur existe en DB (FK contrainte).
  const userIds = Array.from(new Set(entries.map((e) => e.user_id)))
  const { data: existingUsers } = await supabase.from('users').select('id').in('id', userIds)
  const validUserIds = new Set((existingUsers || []).map((u: any) => String(u.id)))
  const validEntries = entries.filter((e) => validUserIds.has(e.user_id))
  if (validEntries.length === 0) return

  // On batch en lots de 50 pour ne pas saturer la base.
  for (let i = 0; i < validEntries.length; i += 50) {
    const batch = validEntries.slice(i, i + 50)
    const rows = await Promise.all(
      batch.map(async (e) => {
        let imageUrl: string | null = null
        if (/^https?:\/\//.test(e.image_path)) {
          imageUrl = e.image_path
        } else {
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(e.image_path, SIGNED_URL_TTL)
          imageUrl = signed?.signedUrl || null
          if (!imageUrl) {
            const { data: pub } = supabase.storage.from(bucket).getPublicUrl(e.image_path)
            imageUrl = pub?.publicUrl || null
          }
        }
        if (!imageUrl) return null
        return {
          id: localIdToUuid(e.id),
          user_id: e.user_id,
          image_url: imageUrl,
          prompt: e.prompt,
          created_at: e.created_at,
        }
      })
    )
    const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null)
    if (validRows.length === 0) continue
    const { error } = await supabase.from('mythos').upsert(validRows, { onConflict: 'id' })
    if (error) {
      console.warn(`[admin/dashboard] backfill upsert error (batch ${i}):`, error.message)
    }
  }
}

// (legacy unused — gardé pour compat)
function _legacyMonthlyMath() {
  return WEEKLY_PRICE + MONTHLY_PRICE
}
void _legacyMonthlyMath

function buildEmptyDashboard() {
  const now = new Date()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (29 - i))
    return { date: d.toISOString().split('T')[0], revenue: 0, mythos: 0 }
  })
  return {
    totalRevenue: 0, revenue30d: 0, revenueGrowth: 0, totalCost: 0,
    totalMythos: 0, netProfit: 0, margin: 0, activeSubscribers: 0,
    weeklySubscribers: 0, monthlySubscribers: 0,
    totalSubscribersAllTime: 0, cancelledAllTime: 0,
    newSubscribers30d: 0, newSubscribersGrowth: 0,
    churnRate: 0, churnCount: 0,
    dailyRevenue: days, dailyMythos: days,
  }
}

async function handleFinance(res: VercelResponse) {
  const supabase = getSupabase()
  const stripe = getStripe()
  const panelCtx = supabase ? await getAdminPanelExclusionContext(supabase) : { userIds: new Set<string>(), emails: new Set<string>() }

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()
  const startOfMonth = new Date(currentYear, currentMonth, 1)
  const sixMonthsAgo = new Date(currentYear, currentMonth - 5, 1)

  // ─── 1. Stripe : invoices payées des 6 derniers mois ───────────────────────
  const stripeInvoices: Stripe.Invoice[] = []
  const stripeSubsActive: Stripe.Subscription[] = []
  const stripeSubsCanceled: Stripe.Subscription[] = []

  if (stripe) {
    try {
      let starting_after: string | undefined = undefined
      for (let i = 0; i < 5; i++) {
        const page: Stripe.ApiList<Stripe.Invoice> = await stripe.invoices.list({
          status: 'paid',
          created: { gte: Math.floor(sixMonthsAgo.getTime() / 1000) },
          limit: 100,
          ...(starting_after ? { starting_after } : {}),
        })
        stripeInvoices.push(...page.data)
        if (!page.has_more) break
        starting_after = page.data[page.data.length - 1]?.id
      }
      const subsActive = await stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] })
      stripeSubsActive.push(...subsActive.data)
      const subsCanceled = await stripe.subscriptions.list({ status: 'canceled', limit: 100, expand: ['data.customer'] })
      stripeSubsCanceled.push(...subsCanceled.data)
    } catch (e: any) {
      console.error('[admin/finance] stripe error:', e?.message || e)
    }
  }

  const preEpochStripeCustFinance = preEpochStripeCustomerIdsFromSubs([
    ...stripeSubsActive,
    ...stripeSubsCanceled,
  ])

  const stripeInvoicesFiltered = stripeInvoices
    .filter((inv) => stripeCreatedOnOrAfterEpoch(inv.created))
    .filter((inv) => !isPanelExcludedEmail(inv.customer_email || null, panelCtx.emails))
    .filter((inv) => {
      const cid = invoiceStripeCustomerId(inv)
      return !cid || !preEpochStripeCustFinance.has(cid)
    })

  const stripeSubsActiveFiltered = stripeSubsActive.filter(
    (s) =>
      stripeCreatedOnOrAfterEpoch(s.created) &&
      !isPanelExcludedEmail(subscriptionCustomerEmail(s), panelCtx.emails),
  )
  const stripeSubsCanceledFiltered = stripeSubsCanceled.filter(
    (s) =>
      stripeCreatedOnOrAfterEpoch(s.created) &&
      !isPanelExcludedEmail(subscriptionCustomerEmail(s), panelCtx.emails),
  )

  // ─── 2. Supabase : analyses (mythos) des 6 derniers mois ──────────────────
  let mythos: Array<{ id: string; user_id: string; created_at: string }> = []
  if (supabase) {
    const mythosSince = new Date(Math.max(sixMonthsAgo.getTime(), ADMIN_STATS_EPOCH_MS)).toISOString()
    let mq = supabase.from('mythos').select('id, user_id, created_at').gte('created_at', mythosSince)
    if (panelCtx.userIds.size > 0) {
      mq = mq.not('user_id', 'in', `(${Array.from(panelCtx.userIds).join(',')})`)
    }
    const { data } = await mq
    mythos = (data || []) as any
  }

  // ─── 3. Stats du mois en cours ────────────────────────────────────────────
  const startOfMonthTs = Math.floor(startOfMonth.getTime() / 1000)
  const invoicesThisMonth = stripeInvoicesFiltered.filter((inv) => inv.created >= startOfMonthTs)
  const revenueThisMonth = invoicesThisMonth.reduce((acc, inv) => acc + (inv.amount_paid || 0) / 100, 0)
  const newSubsThisMonth = stripeSubsActiveFiltered.filter(
    (s) => s.created >= startOfMonthTs && stripeCreatedOnOrAfterEpoch(s.created),
  ).length
  const cancelledThisMonth = stripeSubsCanceledFiltered.filter(
    (s) =>
      (s.canceled_at || 0) >= startOfMonthTs &&
      cancellationOnOrAfterChurnEpoch(s.canceled_at || 0),
  ).length

  const mythosThisMonth = mythos.filter(m => new Date(m.created_at) >= startOfMonth)
  const costThisMonth = mythosThisMonth.length * COST_PER_IMAGE
  const marginThisMonth = revenueThisMonth - costThisMonth
  const marginPct = revenueThisMonth > 0 ? (marginThisMonth / revenueThisMonth) * 100 : 0
  const totalActive = stripeSubsActiveFiltered.length + cancelledThisMonth
  const churnRate = totalActive > 0 ? (cancelledThisMonth / totalActive) * 100 : 0

  // ─── 4. Évolution sur 6 mois ──────────────────────────────────────────────
  const monthlyData = []
  for (let i = 5; i >= 0; i--) {
    const m = new Date(currentYear, currentMonth - i, 1)
    const mEnd = new Date(currentYear, currentMonth - i + 1, 1)
    const mStart = Math.floor(m.getTime() / 1000)
    const mEndTs = Math.floor(mEnd.getTime() / 1000)
    const label = MONTH_LABELS[m.getMonth()]

    const rev = stripeInvoicesFiltered
      .filter(inv => inv.created >= mStart && inv.created < mEndTs)
      .reduce((acc, inv) => acc + (inv.amount_paid || 0) / 100, 0)
    const mythosInMonth = mythos.filter(mt =>
      new Date(mt.created_at) >= m && new Date(mt.created_at) < mEnd
    )
    const cost = mythosInMonth.length * COST_PER_IMAGE

    monthlyData.push({
      month: label,
      revenue: +rev.toFixed(2),
      cost: +cost.toFixed(2),
      margin: +(rev - cost).toFixed(2),
    })
  }

  // ─── 5. Répartition des plans (depuis Stripe) ─────────────────────────────
  let weeklyCount = 0
  let monthlyCount = 0
  for (const sub of stripeSubsActiveFiltered) {
    const priceId = sub.items?.data?.[0]?.price?.id
    const plan = planFromPriceId(priceId)
    if (plan === 'weekly') weeklyCount++
    else if (plan === 'monthly') monthlyCount++
  }

  // ─── 6. Top clients : analyses Supabase + email Stripe ────────────────────
  const mythosByUser: Record<string, number> = {}
  mythos.forEach(m => { mythosByUser[m.user_id] = (mythosByUser[m.user_id] || 0) + 1 })

  // Map Supabase user.id → email + plan
  const userMap: Record<string, { email: string; plan: string }> = {}
  if (supabase) {
    const ids = Object.keys(mythosByUser)
    if (ids.length > 0) {
      const { data: dbUsers } = await supabase
        .from('users')
        .select('id, email, plan')
        .in('id', ids)
      for (const u of (dbUsers || [])) {
        userMap[u.id] = { email: u.email || '', plan: u.plan || 'unknown' }
      }
    }
  }

  const topClients = Object.entries(mythosByUser)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([userId, count]) => {
      const u = userMap[userId]
      const rev = u?.plan === 'weekly' ? WEEKLY_PRICE * 4.33 : MONTHLY_PRICE
      return {
        email: u?.email || userId.slice(0, 8) + '...',
        plan: u?.plan || 'unknown',
        mythos: count,
        revenue: +rev.toFixed(2),
        cost: +(count * COST_PER_IMAGE).toFixed(2),
      }
    })

  return res.status(200).json({
    currentMonth: {
      revenue: +revenueThisMonth.toFixed(2),
      cost: +costThisMonth.toFixed(2),
      margin: +marginThisMonth.toFixed(2),
      marginPct: +marginPct.toFixed(1),
      mythos: mythosThisMonth.length,
      newSubscribers: newSubsThisMonth,
      cancellations: cancelledThisMonth,
      churnRate: +churnRate.toFixed(1),
    },
    monthlyData,
    planSplit: { weekly: weeklyCount, monthly: monthlyCount },
    topClients,
    stripeAvailable: !!stripe,
  })
}

function buildEmptyFinance() {
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { month: MONTH_LABELS[m.getMonth()], revenue: 0, cost: 0, margin: 0 }
  })
  return {
    currentMonth: { revenue: 0, cost: 0, margin: 0, marginPct: 0, mythos: 0, newSubscribers: 0, cancellations: 0, churnRate: 0 },
    monthlyData: months,
    planSplit: { weekly: 0, monthly: 0 },
    topClients: [],
  }
}

async function handleMythos(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(200).json({ mythos: [], total: 0 })

  const page = parseInt(req.query.page as string) || 1
  const limit = parseInt(req.query.limit as string) || 100

  const panelCtx = await getAdminPanelExclusionContext(supabase)
  const epochIso = new Date(ADMIN_STATS_EPOCH_MS).toISOString()

  // ─── On fusionne 2 sources comme le dashboard : ────────────────────────────
  //   1) public.mythos (SQL) — mirror, peut être en retard / incomplet
  //   2) Storage manifests {uid}/index.json — vérité côté front
  // Sans ça, la page Analyses était vide alors que des mythos existaient
  // bien dans Storage (ce qui aussi expliquait Coût IA > 0 mais Analyses=0).
  let sqlQ = supabase
    .from('mythos')
    .select('id, user_id, prompt, image_url, created_at')
    .gte('created_at', epochIso)
    .order('created_at', { ascending: false })
  if (panelCtx.userIds.size > 0) {
    sqlQ = sqlQ.not('user_id', 'in', `(${Array.from(panelCtx.userIds).join(',')})`)
  }
  const [{ data: sqlRows, error: sqlErr }, storageMythos] = await Promise.all([
    sqlQ,
    collectMythosFromStorage(supabase, panelCtx.userIds).catch((e) => {
      console.warn('[admin/mythos] storage scan KO:', e?.message || e)
      return [] as Array<{ id: string; user_id: string; created_at: string; image_path: string; prompt: string }>
    }),
  ])
  if (sqlErr) {
    console.warn('[admin/mythos] sql:', sqlErr.message)
  }

  type Item = {
    id: string
    user_id: string
    prompt: string
    image_url: string | null
    created_at: string
  }
  const items: Item[] = []
  const seenIds = new Set<string>()

  for (const row of (sqlRows as any[]) || []) {
    const id = String(row.id)
    seenIds.add(id)
    items.push({
      id,
      user_id: String(row.user_id),
      prompt: String(row.prompt || ''),
      image_url: row.image_url ? String(row.image_url) : null,
      created_at: String(row.created_at),
    })
  }

  // Storage : on n'ajoute que les entrées qui ne sont pas déjà en SQL (clé
  // déterministe via localIdToUuid). Ce sont les mythos générés mais pas
  // encore mirrorés. Pour eux, on génère une URL signée à la volée.
  const bucket = String(process.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'
  const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 jours
  const storageOnly = (storageMythos || []).filter((e) => {
    if (panelCtx.userIds.has(e.user_id)) return false
    if (!mythoOnOrAfterEpoch(e.created_at)) return false
    const sqlId = localIdToUuid(e.id)
    return !seenIds.has(sqlId)
  })
  const storageItems: Item[] = await Promise.all(
    storageOnly.map(async (e) => {
      let imageUrl: string | null = null
      if (/^https?:\/\//.test(e.image_path)) {
        imageUrl = e.image_path
      } else {
        try {
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(e.image_path, SIGNED_URL_TTL)
          imageUrl = signed?.signedUrl || null
          if (!imageUrl) {
            const { data: pub } = supabase.storage.from(bucket).getPublicUrl(e.image_path)
            imageUrl = pub?.publicUrl || null
          }
        } catch {
          imageUrl = null
        }
      }
      return {
        id: localIdToUuid(e.id),
        user_id: e.user_id,
        prompt: e.prompt,
        image_url: imageUrl,
        created_at: e.created_at,
      }
    }),
  )
  items.push(...storageItems)

  // Tri global par date desc, puis pagination
  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const total = items.length
  const start = (page - 1) * limit
  const paged = items.slice(start, start + limit)

  // Map user_id → email pour la colonne Utilisateur
  const userIds = [...new Set(paged.map((m) => m.user_id))]
  const emailById: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: urows } = await supabase.from('users').select('id, email').in('id', userIds)
    for (const u of urows || []) emailById[String((u as any).id)] = String((u as any).email || '—')
  }

  return res.status(200).json({
    mythos: paged.map((m) => ({
      ...m,
      user_email: emailById[m.user_id] || '—',
      aspect_ratio: '9:16',
      cost: COST_PER_IMAGE,
    })),
    total,
  })
}

async function handleUsers(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase()
  const stripe = getStripe()

  const page = parseInt(req.query.page as string) || 1
  const limit = parseInt(req.query.limit as string) || 50
  const search = (req.query.search as string) || ''
  const planFilter = (req.query.plan as string) || 'all'
  const statusFilter = (req.query.status as string) || 'all'

  const panelCtx = supabase ? await getAdminPanelExclusionContext(supabase) : { userIds: new Set<string>(), emails: new Set<string>() }

  // ─── 1. Liste tous les abonnés Stripe (active + canceled) ─────────────────
  type StripeUser = {
    email: string
    plan: 'weekly' | 'monthly' | 'unknown'
    subscription_status: 'active' | 'cancelled'
    created_at: string
    customer_id: string
    revenue_eur: number
  }
  const stripeUsersByEmail = new Map<string, StripeUser>()

  if (stripe) {
    try {
      // Active
      const subsActive = await stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] })
      // Canceled
      const subsCanceled = await stripe.subscriptions.list({ status: 'canceled', limit: 100, expand: ['data.customer'] })

      const all = [...subsActive.data, ...subsCanceled.data]
      for (const sub of all) {
        if (!stripeCreatedOnOrAfterEpoch(sub.created)) continue
        const customer = sub.customer as Stripe.Customer | string
        const email = (typeof customer === 'string' ? '' : customer.email) || ''
        if (!email) continue
        const key = email.toLowerCase()
        const existing = stripeUsersByEmail.get(key)
        if (existing) continue // garde la première (la plus récente vu l'ordre Stripe)

        const priceId = sub.items?.data?.[0]?.price?.id
        const p = planFromPriceId(priceId)
        const status = sub.status === 'active' ? 'active' : 'cancelled'
        // Estimation revenu = prix × nombre cycles facturés
        const monthlyEq = p === 'weekly' ? WEEKLY_PRICE * 4.33 : (p === 'monthly' ? MONTHLY_PRICE : 0)
        stripeUsersByEmail.set(key, {
          email,
          plan: p,
          subscription_status: status,
          created_at: new Date(sub.created * 1000).toISOString(),
          customer_id: typeof customer === 'string' ? customer : customer.id,
          revenue_eur: +monthlyEq.toFixed(2),
        })
      }
    } catch (e: any) {
      console.error('[admin/users] stripe error:', e?.message || e)
    }
  }

  // ─── 2. Récupère les users Supabase pour mapper avec leurs analyses ───────
  type DbUser = {
    id: string
    email: string
    plan?: string
    subscription_status?: string
    created_at: string
  }
  let dbUsers: DbUser[] = []
  let mythoCountByUser: Record<string, number> = {}
  if (supabase) {
    const epochIso = new Date(ADMIN_STATS_EPOCH_MS).toISOString()
    // On compte les mythos depuis DEUX sources et on dédoublonne par UUID
    // dérivé. Parce que l'app écrit d'abord dans Storage (manifest JSON),
    // puis mirror en SQL — et le mirror peut être en retard ou avoir foiré.
    // Si on ne lit que SQL, certains users apparaissent à 0 alors qu'ils ont
    // bien généré des mythos.
    const [{ data: userRows }, { data: mythoRows }, storageMythos] = await Promise.all([
      supabase.from('users').select('id, email, plan, subscription_status, created_at'),
      supabase.from('mythos').select('id, user_id').gte('created_at', epochIso),
      collectMythosFromStorage(supabase, panelCtx.userIds).catch(() => [] as any[]),
    ])
    dbUsers = (userRows || []) as any
    const sqlIdSet = new Set<string>()
    for (const row of mythoRows || []) {
      const id = String((row as { id: string; user_id: string }).id)
      const uid = String((row as { user_id: string }).user_id)
      if (panelCtx.userIds.has(uid)) continue
      sqlIdSet.add(id)
      mythoCountByUser[uid] = (mythoCountByUser[uid] || 0) + 1
    }
    for (const e of storageMythos as Array<{ id: string; user_id: string; created_at: string }>) {
      if (panelCtx.userIds.has(e.user_id)) continue
      if (!mythoOnOrAfterEpoch(e.created_at)) continue
      const sqlId = localIdToUuid(e.id)
      if (sqlIdSet.has(sqlId)) continue
      mythoCountByUser[e.user_id] = (mythoCountByUser[e.user_id] || 0) + 1
    }
  }

  // ─── 3. Fusion par email — Stripe = vérité paiement, Supabase = analyses ──
  const merged = new Map<string, any>()

  for (const dbUser of dbUsers) {
    const key = (dbUser.email || '').toLowerCase()
    if (!key) continue
    const stripeData = stripeUsersByEmail.get(key)
    const totalMythos = mythoCountByUser[dbUser.id] || 0
    merged.set(key, {
      id: dbUser.id,
      email: dbUser.email,
      plan: stripeData?.plan || dbUser.plan || 'unknown',
      subscription_status: stripeData?.subscription_status || dbUser.subscription_status || 'inactive',
      created_at: dbUser.created_at,
      total_mythos: totalMythos,
      total_cost_eur: +(totalMythos * COST_PER_IMAGE).toFixed(2),
      total_revenue_eur: stripeData?.revenue_eur || 0,
      net_eur: +((stripeData?.revenue_eur || 0) - totalMythos * COST_PER_IMAGE).toFixed(2),
    })
  }

  // 3b. Ajoute les abonnés Stripe qui n'ont pas (encore) de compte Supabase
  for (const [key, stripeData] of stripeUsersByEmail) {
    if (merged.has(key)) continue
    merged.set(key, {
      id: `stripe_${stripeData.customer_id}`,
      email: stripeData.email,
      plan: stripeData.plan,
      subscription_status: stripeData.subscription_status,
      created_at: stripeData.created_at,
      total_mythos: 0,
      total_cost_eur: 0,
      total_revenue_eur: stripeData.revenue_eur,
      net_eur: stripeData.revenue_eur,
    })
  }

  // ─── 4. Filtres + pagination ──────────────────────────────────────────────
  let users = Array.from(merged.values()).filter(
    (u) => !panelCtx.emails.has(normEmail(u.email)),
  )
  users = users.filter((u) => new Date(u.created_at).getTime() >= ADMIN_STATS_EPOCH_MS)
  if (search) {
    const s = search.toLowerCase()
    users = users.filter(u => u.email.toLowerCase().includes(s))
  }
  if (planFilter !== 'all') users = users.filter(u => u.plan === planFilter)
  if (statusFilter !== 'all') users = users.filter(u => u.subscription_status === statusFilter)

  users.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const total = users.length
  const paged = users.slice((page - 1) * limit, page * limit)

  return res.status(200).json({ users: paged, total })
}

async function handlePanelExclusions(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase non configuré' })

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('admin_panel_exclusions')
      .select('email_norm, user_id, excluded_at')
      .order('excluded_at', { ascending: false })
    if (error) {
      console.warn('[admin/exclusions]', error.message)
      return res.status(200).json({ exclusions: [] })
    }
    return res.status(200).json({ exclusions: data || [] })
  }

  if (req.method === 'POST') {
    let body: { email?: string; user_id?: string | null } = {}
    try {
      if (req.body == null || req.body === '') body = {}
      else if (typeof req.body === 'string') body = JSON.parse(req.body || '{}')
      else if (typeof req.body === 'object') body = req.body as typeof body
    } catch {
      body = {}
    }
    const emailRaw = normEmail(body.email)
    if (!emailRaw || !emailRaw.includes('@')) return res.status(400).json({ error: 'Email invalide' })
    const uid = body.user_id && UUID_REGEX.test(String(body.user_id)) ? String(body.user_id) : null
    const row: { email_norm: string; excluded_at: string; user_id?: string } = {
      email_norm: emailRaw,
      excluded_at: new Date().toISOString(),
    }
    if (uid) row.user_id = uid
    const { error } = await supabase.from('admin_panel_exclusions').upsert(row, { onConflict: 'email_norm' })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const email = normEmail(req.query.email as string)
    if (!email) return res.status(400).json({ error: 'Paramètre email requis' })
    const { error } = await supabase.from('admin_panel_exclusions').delete().eq('email_norm', email)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Méthode non autorisée' })
}

async function handleSettings(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      costPerImage: COST_PER_IMAGE,
      maintenanceMode: false,
      notificationEmail: '',
    })
  }
  if (req.method === 'POST') {
    return res.status(200).json({ success: true })
  }
  return res.status(405).json({ error: 'Méthode non autorisée' })
}

// Supprime les lignes public.mythos antérieures à la baseline stats admin
// (aligné sur les agrégats du panel). Idempotent.
async function handlePurgeStatsEpoch(res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase non configuré' })
  const iso = new Date(ADMIN_STATS_EPOCH_MS).toISOString()
  try {
    const { count, error: cntErr } = await supabase
      .from('mythos')
      .select('*', { count: 'exact', head: true })
      .lt('created_at', iso)
    if (cntErr) throw cntErr
    const { error: delErr } = await supabase.from('mythos').delete().lt('created_at', iso)
    if (delErr) throw delErr
    return res.status(200).json({ ok: true, deleted: count ?? 0, cutoff: iso })
  } catch (e: any) {
    console.error('[admin/purge-stats-epoch]', e?.message || e)
    return res.status(500).json({ error: e?.message || 'Purge impossible' })
  }
}

// ─── Backfill historique : Storage manifests → table SQL public.mythos ───────
//
// Pour chaque manifeste {uid}/index.json présent dans le bucket :
//   1. Si l'utilisateur existe en DB et est resté à plan='free'/inactive
//      (ancien flow buggé) ET qu'il a au moins 1 mytho → on le passe en
//      plan='monthly' / subscription_status='active' (estimation raisonnable).
//   2. Pour chaque mytho du manifeste, on upsert la ligne en SQL avec une
//      URL signée 7 jours.
//
// Ce endpoint peut être rejoué sans risque (idempotent grâce aux upsert).
async function handleMigrate(res: VercelResponse) {
  const supabase = getSupabase()
  if (!supabase) return res.status(500).json({ error: 'Supabase non configuré' })

  const bucket = String(process.env.VITE_SUPABASE_STORAGE_BUCKET || 'mythos').trim() || 'mythos'
  // 1 an (max Supabase) pour que les images restent visibles longtemps
  const SIGNED_URL_TTL = 60 * 60 * 24 * 365

  let usersFixed = 0
  let mythosImported = 0
  let mythosSkipped = 0
  const errors: string[] = []

  try {
    // 1. Lister tous les "dossiers" (= UID) dans le bucket
    const { data: folders, error: listErr } = await supabase.storage.from(bucket).list('', { limit: 1000 })
    if (listErr) {
      return res.status(500).json({ error: `Lecture bucket impossible: ${listErr.message}` })
    }

    for (const folder of folders || []) {
      // On ne traite que les "vrais" dossiers (UID Supabase, pas de fichier à la racine)
      if (!folder.name || folder.name.includes('.')) continue
      const uid = folder.name

      // 2. Télécharger le manifeste de cet utilisateur
      const manifestPath = `${uid}/index.json`
      const { data: manifestBlob, error: dlErr } = await supabase.storage.from(bucket).download(manifestPath)
      if (dlErr || !manifestBlob) continue

      let manifest: { entries?: any[] } = {}
      try {
        manifest = JSON.parse(await manifestBlob.text())
      } catch {
        continue
      }
      const entries = Array.isArray(manifest.entries) ? manifest.entries : []
      if (entries.length === 0) continue

      // 3. Reconstituer chaque mytho dans public.mythos
      for (const entry of entries) {
        if (!entry?.id || !entry?.image_path || !entry?.prompt) {
          mythosSkipped++
          continue
        }
        const entryCreated = String(entry.created_at || new Date().toISOString())
        if (!mythoOnOrAfterEpoch(entryCreated)) {
          mythosSkipped++
          continue
        }
        try {
          let imageUrl: string | null = null
          if (/^https?:\/\//.test(entry.image_path)) {
            imageUrl = entry.image_path
          } else {
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(entry.image_path, SIGNED_URL_TTL)
            imageUrl = signed?.signedUrl || null
            if (!imageUrl) {
              const { data: pub } = supabase.storage.from(bucket).getPublicUrl(entry.image_path)
              imageUrl = pub?.publicUrl || null
            }
          }
          if (!imageUrl) { mythosSkipped++; continue }

          const { error: upErr } = await supabase.from('mythos').upsert(
            [{
              id: localIdToUuid(String(entry.id)),
              user_id: uid,
              image_url: imageUrl,
              prompt: String(entry.prompt),
              created_at: entryCreated,
            }],
            { onConflict: 'id' }
          )
          if (upErr) {
            mythosSkipped++
            errors.push(`mytho ${entry.id}: ${upErr.message}`)
          } else {
            mythosImported++
          }
        } catch (e: any) {
          mythosSkipped++
          errors.push(`mytho ${entry.id}: ${e?.message || 'erreur inconnue'}`)
        }
      }

      // 4. Si le user a des mythos mais est resté en plan='free' / inactive,
      //    on l'active avec un plan mensuel par défaut (estimation prudente).
      try {
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, plan, subscription_status, credits_remaining')
          .eq('id', uid)
          .single()

        if (dbUser) {
          const isUninitialized =
            dbUser.subscription_status !== 'active' ||
            dbUser.plan === 'free' ||
            (dbUser.credits_remaining ?? 0) === 0

          if (isUninitialized) {
            const remaining = Math.max(560 - entries.length * 8, 0)
            await supabase.from('users').update({
              plan: 'monthly',
              subscription_status: 'active',
              credits_remaining: remaining,
            }).eq('id', uid)
            usersFixed++
          }
        }
      } catch (e: any) {
        errors.push(`user ${uid}: ${e?.message || 'erreur inconnue'}`)
      }
    }

    return res.status(200).json({
      ok: true,
      usersFixed,
      mythosImported,
      mythosSkipped,
      foldersScanned: (folders || []).length,
      errors: errors.slice(0, 20),
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Migration échouée' })
  }
}
