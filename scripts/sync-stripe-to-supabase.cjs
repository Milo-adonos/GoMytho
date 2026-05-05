/* eslint-disable */
// Sync : récupère TOUS les abonnements Stripe (active + trialing) et met à jour
// la table public.users en conséquence.
// Identification d'un user Supabase :
//   1. par client_reference_id (= user.id Supabase) sur la dernière session checkout
//   2. sinon par stripe_customer_id déjà connu
//   3. sinon par email (customer.email == users.email)

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const PROJECT_REF = 'cnsxhuiljemryzvtlcdm'
const PG_PASSWORD = process.env.SUPA_DB_PASSWORD
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY
const HEBDO_PRICE_ID = (process.env.HEBDO_PRICE_ID || '').trim()
const MENSU_PRICE_ID = (process.env.MENSU_PRICE_ID || '').trim()

if (!PG_PASSWORD) { console.error('SUPA_DB_PASSWORD manquant'); process.exit(1) }
if (!STRIPE_KEY) { console.error('STRIPE_SECRET_KEY manquant'); process.exit(1) }

const Stripe = require('stripe')
const stripe = new Stripe(STRIPE_KEY)

const PLAN_CREDITS = { weekly: 160, monthly: 560 }
const MONTHLY_TRIAL_CREDITS = 8
const HEBDO_AMOUNT_CENTS = 299
const MENSU_AMOUNT_CENTS = 990

function planFromPriceId(priceId) {
  if (!priceId) return null
  if (HEBDO_PRICE_ID && priceId === HEBDO_PRICE_ID) return 'weekly'
  if (MENSU_PRICE_ID && priceId === MENSU_PRICE_ID) return 'monthly'
  return null
}

function planFromAmount(cents) {
  if (cents == null) return null
  if (cents === HEBDO_AMOUNT_CENTS) return 'weekly'
  if (cents === MENSU_AMOUNT_CENTS) return 'monthly'
  return null
}

async function findCheckoutSessionForCustomer(customerId) {
  const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 5 })
  // on prend la session payée la plus récente
  return sessions.data.find((s) => s.status === 'complete' || s.payment_status === 'paid') || sessions.data[0] || null
}

async function pickPlanForSubscription(sub, fallbackSession) {
  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id
  let plan = planFromPriceId(priceId)
  if (!plan && item?.price?.unit_amount != null) plan = planFromAmount(item.price.unit_amount)
  if (!plan && fallbackSession?.amount_total != null) plan = planFromAmount(fallbackSession.amount_total)
  return plan
}

function creditsFor(plan, status) {
  if (status === 'trialing' && plan === 'monthly') return MONTHLY_TRIAL_CREDITS
  return PLAN_CREDITS[plan] ?? 0
}

async function main() {
  const pg = new Client({
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: PG_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
  await pg.connect()
  console.log('✅ connecté Postgres')

  console.log('\n=== Liste des abonnements Stripe (active + trialing) ===')
  const subs = []
  for (const status of ['active', 'trialing']) {
    let starting_after = undefined
    while (true) {
      const page = await stripe.subscriptions.list({ status, limit: 100, ...(starting_after ? { starting_after } : {}) })
      subs.push(...page.data)
      if (!page.has_more) break
      starting_after = page.data[page.data.length - 1].id
    }
  }
  console.log(`→ ${subs.length} abonnement(s)`)

  let synced = 0, skipped = 0
  for (const sub of subs) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
    if (!customerId) { skipped++; continue }

    let customer
    try {
      customer = await stripe.customers.retrieve(customerId)
    } catch (e) { skipped++; continue }
    if (customer.deleted) { skipped++; continue }

    const email = customer.email || null
    const session = await findCheckoutSessionForCustomer(customerId)
    const plan = await pickPlanForSubscription(sub, session)
    if (!plan) { console.log(`✗ skip ${customerId} (plan inconnu)`); skipped++; continue }

    const status = sub.status === 'trialing' ? 'trialing' : 'active'
    const credits = creditsFor(plan, status)
    const clientRef = session?.client_reference_id || null
    const stripeEmail = session?.customer_details?.email || email

    let userRow = null
    if (clientRef) {
      const r = await pg.query('SELECT id, email FROM public.users WHERE id = $1', [clientRef])
      userRow = r.rows[0] || null
    }
    if (!userRow) {
      const r = await pg.query('SELECT id, email FROM public.users WHERE stripe_customer_id = $1', [customerId])
      userRow = r.rows[0] || null
    }
    if (!userRow && email) {
      const r = await pg.query('SELECT id, email FROM public.users WHERE LOWER(email) = LOWER($1)', [email])
      userRow = r.rows[0] || null
    }

    if (!userRow) {
      console.log(`✗ aucun user Supabase pour customer=${customerId} email=${email}`)
      skipped++; continue
    }

    await pg.query(
      `UPDATE public.users
       SET plan = $1,
           subscription_status = $2,
           credits_remaining = GREATEST(credits_remaining, $3),
           stripe_customer_id = $4,
           stripe_payment_email = COALESCE($5, stripe_payment_email)
       WHERE id = $6`,
      [plan, status, credits, customerId, stripeEmail, userRow.id]
    )
    console.log(`✅ ${userRow.email} → ${plan}/${status} (${credits} crédits)`)
    synced++
  }

  console.log(`\n=== ${synced} user(s) sync — ${skipped} skip ===`)
  await pg.end()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
