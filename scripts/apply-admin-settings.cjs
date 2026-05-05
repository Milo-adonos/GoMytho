/* eslint-disable */
// Crée la table admin_settings + initialise churn_epoch_ms à NOW() pour
// exclure toutes les annulations Stripe existantes du panel admin (elles
// ont été initiées par l'admin, pas par les users).

const { Client } = require('pg')

const PROJECT_REF = 'cnsxhuiljemryzvtlcdm'
const PASSWORD = process.env.SUPA_DB_PASSWORD
if (!PASSWORD) { console.error('SUPA_DB_PASSWORD manquant'); process.exit(1) }

async function main() {
  const c = new Client({
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  console.log('✅ connecté Postgres')

  await c.query(`
    CREATE TABLE IF NOT EXISTS public.admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    COMMENT ON TABLE public.admin_settings IS
      'Paramètres d''admin modifiables à chaud (clé/valeur).';
  `)
  console.log('✅ table admin_settings prête')

  const nowMs = Date.now()
  await c.query(
    `INSERT INTO public.admin_settings(key, value, updated_at)
     VALUES ('churn_epoch_ms', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
    [String(nowMs)],
  )
  console.log(`✅ churn_epoch_ms = ${nowMs}  (${new Date(nowMs).toISOString()})`)

  const r = await c.query(`SELECT key, value, updated_at FROM public.admin_settings ORDER BY key;`)
  console.table(r.rows)

  await c.end()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
