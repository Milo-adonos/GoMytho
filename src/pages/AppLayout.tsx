import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, User } from '@/lib/supabase'
import { generateMytho, uploadToSupabase, KieBlockedError } from '@/lib/kie-api'
import { saveMythoToCloud } from '@/lib/mythos-sync'
import type { AspectRatio } from '@/lib/kie-api'
import {
  cachePlanLocally,
  PLAN_CREDITS,
  readCachedPlan,
  resolveNewUserPlan,
  type Plan,
} from '@/lib/plan'

export interface AppUser extends User {}

async function dataUrlToPublicUrl(
  dataUrl: string,
  userId: string,
  filename: string
): Promise<string> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
  return uploadToSupabase(file, userId)
}

function clearPendingMytho() {
  try {
    localStorage.removeItem('gomytho_pending_image')
    localStorage.removeItem('gomytho_pending_image2')
    localStorage.removeItem('gomytho_pending_prompt')
    localStorage.removeItem('gomytho_pending_ratio')
    localStorage.removeItem('gomytho_pending_plan')
  } catch { /* ignore */ }
}

// ─── Retry helper avec backoff exponentiel ─────────────────────────────────
// On ne retente JAMAIS sur un blocage de modération (l'IA refusera tout pareil)
// → on remonte l'erreur immédiatement.
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastErr: unknown = null
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const result = await fn()
      if (i > 1) console.info(`[autoGen] ${label} → réussi après ${i} tentatives`)
      return result
    } catch (err) {
      lastErr = err
      if (err instanceof KieBlockedError) throw err
      console.warn(`[autoGen] ${label} échec tentative ${i}/${attempts}:`, err)
      if (i < attempts) {
        const delay = Math.min(8000, 1500 * Math.pow(2, i - 1))
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

async function tryAutoGenerate(userId: string): Promise<boolean> {
  const pendingImage = localStorage.getItem('gomytho_pending_image')
  const pendingImage2 = localStorage.getItem('gomytho_pending_image2')
  const pendingPrompt = localStorage.getItem('gomytho_pending_prompt')
  const pendingRatio = (localStorage.getItem('gomytho_pending_ratio') || '9:16') as AspectRatio
  if (!pendingImage || !pendingPrompt) {
    console.info('[autoGen] aborted: pending data missing (image or prompt)')
    return false
  }
  try {
    console.info('[autoGen] step 1/4 — upload photo principale (retry x3)...')
    const publicUrl = await withRetry('upload photo 1', () =>
      dataUrlToPublicUrl(pendingImage, userId, 'photo.jpg')
    )

    let publicUrl2: string | null = null
    if (pendingImage2) {
      try {
        console.info('[autoGen] step 1bis — upload photo 2 (retry x3)...')
        publicUrl2 = await withRetry('upload photo 2', () =>
          dataUrlToPublicUrl(pendingImage2, userId, 'photo2.jpg')
        )
      } catch (e2) {
        console.warn('[autoGen] upload photo 2 abandonné après retries (non bloquant):', e2)
      }
    }

    const imageUrls = publicUrl2 ? [publicUrl, publicUrl2] : [publicUrl]
    console.info('[autoGen] step 2/4 — génération via Kie.ai (retry x2)...', { imageCount: imageUrls.length })
    const { dataUrl, remoteUrl } = await withRetry(
      'generateMytho',
      () =>
        generateMytho(
          { userPrompt: pendingPrompt, imageUrls, aspectRatio: pendingRatio },
          (s) => console.info('[autoGen] kie:', s)
        ),
      2
    )

    console.info('[autoGen] step 3/4 — sauvegarde dans Créations...')
    // L'image est générée — on est obligés de la mettre dans Créations.
    // Si saveMythoToCloud foire (ex. quota Supabase), on retombe sur un
    // ajout direct au cache local avec l'URL Kie.ai (toujours visible).
    try {
      await withRetry(
        'saveMythoToCloud',
        () => saveMythoToCloud({ userId, generatedDataUrl: dataUrl, prompt: pendingPrompt }),
        2
      )
    } catch (saveErr) {
      console.warn('[autoGen] saveMythoToCloud KO, fallback cache local pur:', saveErr)
      try {
        const { readLocalCreations, writeLocalCreations } = await import('@/lib/mythos-sync')
        const list = readLocalCreations(userId)
        writeLocalCreations(userId, [
          {
            id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            user_id: userId,
            image_url: remoteUrl || dataUrl,
            preview_data_url: dataUrl,
            prompt: pendingPrompt,
            created_at: new Date().toISOString(),
          },
          ...list,
        ])
      } catch (cacheErr) {
        console.error('[autoGen] fallback cache local lui-même KO:', cacheErr)
        throw saveErr
      }
    }

    console.info('[autoGen] step 4/4 — clean pending data ✅')
    clearPendingMytho()
    return true
  } catch (err) {
    console.error('[autoGen] échec définitif après retries :', err)
    // Stockage du dernier message d'erreur pour affichage côté UI (banner).
    try {
      if (err instanceof KieBlockedError) {
        sessionStorage.setItem(
          'gomytho_last_gen_error',
          JSON.stringify({ code: err.code, message: err.message, blocked: true })
        )
      } else {
        sessionStorage.setItem(
          'gomytho_last_gen_error',
          JSON.stringify({
            code: 'GEN_FAILED',
            message:
              (err as Error)?.message ||
              "La génération a échoué. Vérifie ta connexion et relance depuis l'onglet Créer.",
            blocked: false,
          })
        )
      }
    } catch { /* ignore */ }
    // On NE clear PAS les pending data → relance manuelle possible depuis /makemytho.
    return false
  }
}

async function waitForSession(maxAttempts = 20, delayMs = 250) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const { data } = await supabase.auth.getSession()
      if (data?.session) return data.session
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

export default function AppLayout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoGen, setAutoGen] = useState(false)
  // Garde-fou : empêche le useEffect de relancer l'init (et donc l'auto-gen)
  // si searchParams change pendant qu'on est encore dans la 1ʳᵉ exécution.
  const initRanRef = useRef(false)

  useEffect(() => {
    if (initRanRef.current) return
    initRanRef.current = true
    const init = async () => {
      const session = await waitForSession()

      if (!session) {
        window.location.href = '/login'
        return
      }

      const authUser = session.user

      // ─── 1. Lecture du profil DB (source de vérité cross-device) ────────────
      let dbUser: any = null
      try {
        const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
        dbUser = data || null
      } catch {
        dbUser = null
      }

      // Identifie l'utilisateur dans PostHog (no-op si non configuré).
      try {
        const { identifyUser } = await import('@/lib/analytics')
        identifyUser(authUser.id, {
          email: authUser.email,
          plan: dbUser?.plan ?? 'free',
          credits: dbUser?.credits_remaining ?? 0,
        })
      } catch { /* ignore */ }

      const hasPending = !!(localStorage.getItem('gomytho_pending_image') && localStorage.getItem('gomytho_pending_prompt'))
      // "Fresh payment" = signal explicite qu'on revient d'un parcours d'achat
      // (URL Stripe redirect ou plan en attente non encore consommé). Sans ce
      // signal, on NE déclenche JAMAIS l'auto-génération même si des pending
      // photos traînent dans localStorage : ce sont alors des résidus d'une
      // session précédente abandonnée — pas la volonté actuelle de l'user.
      const hasFreshPayment = !!searchParams.get('session_id') || !!searchParams.get('plan') || !!localStorage.getItem('gomytho_pending_plan')

      // ─── 2. Si user fraîchement payé OU profil DB non initialisé → upsert ──
      // Le trigger Supabase crée la ligne avec credits=0/plan='free'. Si on
      // détecte un paiement (URL ou pending storage) ou que le profil est
      // resté à 0 crédits, on l'enrichit en vérifiant Stripe quand possible.
      const dbIsUninitialized = !dbUser || (dbUser.plan === 'free' && (dbUser.credits_remaining ?? 0) === 0)

      if (dbIsUninitialized && hasFreshPayment) {
        const verified = await resolveNewUserPlan(searchParams)
        const upsertRow: Record<string, unknown> = {
          id: authUser.id,
          email: authUser.email!,
          credits_remaining: verified.credits,
          subscription_status: 'active' as const,
          plan: verified.plan,
        }
        if (verified.customerId) {
          upsertRow.stripe_customer_id = verified.customerId
        }
        // Email Stripe réel (peut différer de authUser.email si Apple Pay /
        // Google Pay / alias). Indispensable pour retrouver le customer si
        // stripe_customer_id n'est jamais persisté.
        if (verified.email) {
          upsertRow.stripe_payment_email = verified.email
        }
        try {
          await supabase.from('users').upsert([upsertRow], { onConflict: 'id' })
          dbUser = { ...upsertRow, created_at: new Date().toISOString() }
        } catch (err) {
          console.warn('[AppLayout] upsert plan échoué (fallback localStorage):', err)
          dbUser = dbUser || {
            ...upsertRow,
            stripe_customer_id: verified.customerId || null,
            stripe_payment_email: verified.email || null,
            created_at: new Date().toISOString(),
          }
        }
        cachePlanLocally(verified.plan, verified.credits)
        try {
          localStorage.removeItem('gomytho_pending_plan')
        } catch { /* ignore */ }
      }

      // ─── 3. Construction de l'objet user (DB > cache local > défaut) ────────
      let resolvedUser: AppUser
      if (dbUser) {
        resolvedUser = dbUser as AppUser
        cachePlanLocally(
          (dbUser.plan as Plan) || 'monthly',
          Number(dbUser.credits_remaining ?? PLAN_CREDITS.monthly)
        )
      } else {
        const cached = readCachedPlan()
        resolvedUser = {
          id: authUser.id,
          email: authUser.email!,
          credits_remaining: cached.credits,
          subscription_status: 'active',
          plan: cached.plan,
          created_at: new Date().toISOString(),
        } as AppUser
      }

      setUser(resolvedUser)
      setLoading(false)

      // ─── 4. Auto-génération si fresh payment + pending photos ─────────────
      // Cas valide  : user vient de payer et arrive sur l'app pour la 1ère
      //               fois → on génère son mytho automatiquement.
      // Cas invalide: simple login depuis la landing avec des pending résidus
      //               de session précédente → on les purge pour pas qu'une
      //               auto-gen absurde ne se déclenche.
      //
      // Note : hasFreshPayment suffit comme signal d'autorisation. Inutile
      // de re-tester userIsInitialized — l'upsert juste au-dessus a marqué
      // le user comme initialisé, ce qui ferait sauter à tort l'auto-gen.
      if (hasPending && hasFreshPayment) {
        setAutoGen(true)
        await tryAutoGenerate(authUser.id)
        setAutoGen(false)
        // Dans TOUS les cas (succès comme échec), on atterrit sur /résultats.
        // - Succès → le mytho est dans le cache local (saveMythoToCloud) →
        //   AppCreations le lit et l'affiche immédiatement.
        // - Échec  → /résultats vide, mais les pending data sont conservées
        //   pour permettre au user de relancer manuellement depuis /makemytho.
        navigate('/resultats', { replace: true })
        // En cas d'échec, l'erreur a été stockée dans sessionStorage par
        // tryAutoGenerate → AppCreations / AppCreate l'affichera comme un
        // banner stylé (au lieu d'un alert moche).
      } else if (hasPending) {
        clearPendingMytho()
      }
    }

    init()
  }, [searchParams, navigate])

  if (loading || autoGen) {
    return (
      <div className="min-h-screen bg-primary-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <div className="w-16 h-16 rounded-full border-4 border-lime/20 border-t-lime animate-spin" />
          <p className="font-black text-white text-xl">{autoGen ? 'Génération de ton mytho...' : 'Chargement...'}</p>
          {autoGen && <p className="text-text-secondary text-sm">~15 secondes, ne ferme pas cette page</p>}
        </div>
      </div>
    )
  }

  const tabs = [
    { to: '/resultats', icon: '🎨', label: 'Créations' },
    { to: '/makemytho', icon: '✨', label: 'Créer' },
    { to: '/settings', icon: '⚙️', label: 'Paramètres' },
  ]

  return (
    <div className="min-h-screen bg-primary-bg flex flex-col">
      {/* Top bar */}
      <header
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3"
        style={{
          background: 'rgba(10,14,26,0.95)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(198,255,60,0.08)',
        }}
      >
        <span className="text-xl font-black text-lime">GoMytho</span>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold"
          style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.2)' }}
        >
          <span className="text-lime">✨</span>
          <span className="text-white">{user?.credits_remaining ?? 0}</span>
          <span className="text-text-secondary text-xs">crédits</span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pt-[56px] pb-[72px] overflow-auto">
        <Outlet context={{ user, setUser }} />
      </main>

      {/* Bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex"
        style={{
          background: 'rgba(10,14,26,0.97)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(198,255,60,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all relative ${isActive ? '' : 'opacity-40'}`
            }
          >
            {({ isActive }) => (
              <>
                <span className="text-xl">{tab.icon}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-lime' : 'text-text-secondary'}`}>
                  {tab.label}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-lime" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
