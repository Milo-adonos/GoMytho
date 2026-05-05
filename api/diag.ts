import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Endpoint diagnostic GoMytho — ouvre https://<ton-domaine>/api/diag
 *
 * Liste les variables d'environnement Vercel attendues et indique
 * lesquelles sont définies (booléen + longueur, jamais la valeur).
 * Aide à débugger en 1 clic les problèmes de webhook / sync DB.
 *
 * AUCUNE valeur de secret n'est jamais retournée — uniquement présent/absent
 * et longueur. Sans info utile pour un attaquant.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const vars = {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      SUPABASE_URL: process.env.SUPABASE_URL,
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      VITE_KIE_API_KEY: process.env.VITE_KIE_API_KEY,
      HEBDO_PRICE_ID: process.env.HEBDO_PRICE_ID,
      MENSU_PRICE_ID: process.env.MENSU_PRICE_ID,
    }

    const summary: Record<string, { present: boolean; length: number; hint?: string }> = {}
    for (const [key, val] of Object.entries(vars)) {
      const trimmed = (val || '').trim()
      const entry: { present: boolean; length: number; hint?: string } = {
        present: trimmed.length > 0,
        length: trimmed.length,
      }
      // Indice non sensible : préfixe attendu pour les clés sensibles.
      if (trimmed.length > 0) {
        if (key === 'STRIPE_SECRET_KEY') {
          entry.hint = trimmed.startsWith('sk_live_')
            ? 'OK live'
            : trimmed.startsWith('sk_test_')
            ? '⚠️ mode TEST (Payment Links sont en LIVE ?)'
            : '❌ format inattendu (devrait commencer par sk_)'
        } else if (key === 'STRIPE_WEBHOOK_SECRET') {
          entry.hint = trimmed.startsWith('whsec_')
            ? 'OK'
            : '❌ format inattendu (devrait commencer par whsec_)'
        } else if (key === 'SUPABASE_URL' || key === 'VITE_SUPABASE_URL') {
          entry.hint = trimmed.startsWith('https://') && trimmed.endsWith('.supabase.co')
            ? 'OK'
            : '❌ format inattendu (https://xxxxx.supabase.co)'
        }
      }
      summary[key] = entry
    }

    const missingCritical: string[] = []
    if (!summary.STRIPE_SECRET_KEY.present) missingCritical.push('STRIPE_SECRET_KEY')
    if (!summary.STRIPE_WEBHOOK_SECRET.present) missingCritical.push('STRIPE_WEBHOOK_SECRET')
    if (!summary.SUPABASE_URL.present && !summary.VITE_SUPABASE_URL.present) {
      missingCritical.push('SUPABASE_URL (ou VITE_SUPABASE_URL)')
    }
    if (!summary.SUPABASE_SERVICE_ROLE_KEY.present) {
      missingCritical.push('SUPABASE_SERVICE_ROLE_KEY')
    }

    return res.status(200).json({
      ok: missingCritical.length === 0,
      missingCritical,
      summary,
      help:
        missingCritical.length === 0
          ? 'Toutes les variables critiques sont présentes. Si webhook ou paiement échoue : vérifier les valeurs (mode live/test, signing secret, etc.).'
          : 'Ajoute les variables manquantes sur Vercel → Project Settings → Environment Variables, puis redéploie (Deployments → ⋯ → Redeploy sans cache).',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return res.status(500).json({ error: `Diag failed: ${msg}` })
  }
}
