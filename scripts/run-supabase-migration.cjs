/* eslint-disable */
// One-shot migration runner
// Connecte à la base Postgres Supabase et exécute supabase-schema.sql + backfill users.

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const PROJECT_REF = 'cnsxhuiljemryzvtlcdm'
const PASSWORD = process.env.SUPA_DB_PASSWORD

if (!PASSWORD) {
  console.error('SUPA_DB_PASSWORD env var manquante')
  process.exit(1)
}

const SCHEMA_FILE = path.resolve(__dirname, '..', 'supabase-schema.sql')
const sql = fs.readFileSync(SCHEMA_FILE, 'utf8')

// Liste des connexions à essayer dans l'ordre.
// 1. Direct (db.<ref>.supabase.co:5432)
// 2. Pooler session mode (eu-central-1)
// 3. Pooler session mode (us-east-1)
// 4. Pooler session mode (eu-west-3)
const TARGETS = [
  { label: 'direct',           host: `db.${PROJECT_REF}.supabase.co`, port: 5432, user: 'postgres' },
  { label: 'pooler eu-central',host: 'aws-0-eu-central-1.pooler.supabase.com', port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler us-east',   host: 'aws-0-us-east-1.pooler.supabase.com',    port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler eu-west',   host: 'aws-0-eu-west-3.pooler.supabase.com',    port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler eu-west-1', host: 'aws-0-eu-west-1.pooler.supabase.com',    port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler ap-south',  host: 'aws-0-ap-southeast-1.pooler.supabase.com',port: 5432, user: `postgres.${PROJECT_REF}` },
]

async function tryConnect(target) {
  const client = new Client({
    host: target.host,
    port: target.port,
    user: target.user,
    password: PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  await client.connect()
  return client
}

async function main() {
  let client = null
  let lastErr = null
  for (const t of TARGETS) {
    try {
      console.log(`→ tentative ${t.label} (${t.host})…`)
      client = await tryConnect(t)
      console.log(`✅ connecté via ${t.label}`)
      break
    } catch (e) {
      console.log(`✗ ${t.label} : ${e.code || e.message}`)
      lastErr = e
    }
  }
  if (!client) {
    console.error('Aucune connexion possible. Dernière erreur :', lastErr)
    process.exit(2)
  }

  try {
    console.log('\n=== Étape 1 : exécution du schéma SQL ===')
    await client.query(sql)
    console.log('✅ schéma exécuté')

    console.log('\n=== Étape 2 : backfill public.users depuis auth.users ===')
    const { rowCount } = await client.query(`
      INSERT INTO public.users (id, email, credits_remaining)
      SELECT id, email, 0 FROM auth.users
      ON CONFLICT (id) DO NOTHING;
    `)
    console.log(`✅ ${rowCount} ligne(s) insérée(s)`)

    console.log('\n=== Étape 3 : vérif tables ===')
    const tables = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `)
    console.log('Tables publiques :')
    tables.rows.forEach((r) => console.log('  -', r.tablename))

    console.log('\n=== Étape 4 : vérif user(s) ===')
    const users = await client.query(`
      SELECT id, email, plan, subscription_status, credits_remaining, stripe_customer_id
      FROM public.users
      ORDER BY created_at DESC;
    `)
    console.log(`${users.rowCount} user(s) :`)
    users.rows.forEach((u) => {
      console.log(
        `  - ${u.email} | plan=${u.plan} | status=${u.subscription_status} | credits=${u.credits_remaining} | stripe=${u.stripe_customer_id || '∅'}`
      )
    })
  } catch (e) {
    console.error('❌ Erreur SQL :', e.message)
    process.exit(3)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
