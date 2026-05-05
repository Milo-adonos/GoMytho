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
  CREDITS_PER_IMAGE,
  type Plan,
} from '@/lib/plan'
import {
  clearPendingStripeSessionId,
  hasPaidGoMythoAccess,
  NO_SUBSCRIPTION_FLAG_KEY,
  readPendingStripeSessionId,
} from '@/lib/auth-access'

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

    try {
      const { data: row } = await supabase.from('users').select('credits_remaining').eq('id', userId).single()
      const cur = Number(row?.credits_remaining ?? 0)
      const next = Math.max(0, cur - CREDITS_PER_IMAGE)
      await supabase.from('users').update({ credits_remaining: next }).eq('id', userId)
      try {
        const p = localStorage.getItem('gomytho_user_plan')
        if (p === 'weekly' || p === 'monthly' || p === 'free') {
          cachePlanLocally(p, next)
        }
      } catch { /* ignore */ }
    } catch (credErr) {
      console.warn('[autoGen] décrément crédits (non bloquant):', credErr)
    }

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

      // ─── 1. Détection : revient-on de Stripe ? ──────────────────────────
      const justFromStripe = !!searchParams.get('session_id')
      let pendingPlan: 'weekly' | 'monthly' | null = null
      try {
        const stored = localStorage.getItem('gomytho_pending_plan')
        if (stored === 'weekly' || stored === 'monthly') pendingPlan = stored
      } catch { /* ignore */ }
      const expectsWebhook = justFromStripe || !!pendingPlan

      const sidUrl = (searchParams.get('session_id') || '').trim()
      const sidStored = readPendingStripeSessionId()
      const resolvedSessionId =
        /^cs_(live|test)_[A-Za-z0-9]+$/.test(sidUrl) ? sidUrl : sidStored

      const fetchProfile = async () => {
        try {
          const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
          return data || null
        } catch { return null }
      }

      let dbUser: any = await fetchProfile()

      // ─── 2. Si on revient de Stripe et que l'accès n'est pas encore en
      //       DB : appeler `/api/stripe-verify` D'ABORD. Cet endpoint :
      //         a) vérifie auprès de Stripe que la session est bien payée
      //            (réponse en ~500 ms — bien plus rapide que d'attendre
      //            le webhook et son cold start),
      //         b) force la sync de `public.users` côté serveur (service
      //            role), donc plus besoin d'attendre le webhook,
      //         c) renvoie le payload (plan / credits / status) qu'on
      //            utilise comme accès « optimiste » : si Stripe confirme,
      //            l'utilisateur entre dans l'app immédiatement, sans
      //            jamais voir le message d'erreur « activation en cours ».
      type StripeVerifyPayload = {
        plan: 'weekly' | 'monthly'
        credits: number
        subscription_status: 'active' | 'trialing'
        synced?: boolean
      }
      let stripePayload: StripeVerifyPayload | null = null

      if (
        expectsWebhook &&
        !hasPaidGoMythoAccess(dbUser) &&
        resolvedSessionId &&
        session.access_token
      ) {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          try {
            const r = await fetch('/api/stripe-verify', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ session_id: resolvedSessionId }),
            })
            const data = await r.json().catch(() => null)
            if (
              r.ok &&
              data &&
              (data.plan === 'weekly' || data.plan === 'monthly') &&
              typeof data.credits === 'number'
            ) {
              stripePayload = {
                plan: data.plan,
                credits: data.credits,
                subscription_status:
                  data.subscription_status === 'trialing' ? 'trialing' : 'active',
                synced: !!data.synced,
              }
              if (data.synced) {
                dbUser = await fetchProfile()
              }
              break
            }
            if (!r.ok) {
              console.warn('[AppLayout] stripe-verify KO', attempt, data)
            }
          } catch (e) {
            console.warn('[AppLayout] stripe-verify exception', attempt, e)
          }
          if (attempt < 4) await new Promise((r) => setTimeout(r, 800))
        }
      }

      // ─── 3. Polling DB en filet ultime ──────────────────────────────────
      // Si stripe-verify n'a RIEN confirmé non plus (cas extrême : Stripe
      // injoignable, clé serveur fausse), on attend tout de même que le
      // webhook ait peut-être eu le temps d'écrire en DB.
      if (
        expectsWebhook &&
        !hasPaidGoMythoAccess(dbUser) &&
        !stripePayload
      ) {
        for (let i = 0; i < 8; i += 1) {
          await new Promise((r) => setTimeout(r, 750))
          dbUser = await fetchProfile()
          if (hasPaidGoMythoAccess(dbUser)) break
        }
      }

      // ─── 4. Filet « optimiste » : si Stripe a confirmé le paiement mais
      //       que la DB n'a pas encore le plan, on accorde l'accès en se
      //       basant sur le payload Stripe. La sync DB sera de toute façon
      //       complétée (par stripe-verify lui-même, ou par le webhook qui
      //       finira par arriver).
      if (!hasPaidGoMythoAccess(dbUser) && stripePayload) {
        dbUser = {
          ...(dbUser || {
            id: authUser.id,
            email: authUser.email,
            created_at: new Date().toISOString(),
          }),
          plan: stripePayload.plan,
          subscription_status: stripePayload.subscription_status,
          credits_remaining: stripePayload.credits,
        }
        cachePlanLocally(stripePayload.plan, stripePayload.credits)
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

      // ─── 2. Fin d'essai mensuel Stripe : passage en actif + quota complet ───
      if (
        dbUser &&
        dbUser.plan === 'monthly' &&
        dbUser.subscription_status === 'trialing' &&
        session?.access_token
      ) {
        try {
          const r = await fetch('/api/stripe-sync-trial', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          const payload = await r.json().catch(() => null)
          if (r.ok && payload?.updated && typeof payload.credits === 'number') {
            dbUser = {
              ...dbUser,
              subscription_status: 'active',
              credits_remaining: payload.credits,
            }
            cachePlanLocally('monthly', payload.credits)
          }
        } catch { /* ignore */ }
      }

      // ─── 5. Vérification accès payant (filet final) ─────────────────────
      // Ici on a déjà :
      //   - lu la DB,
      //   - appelé stripe-verify (réponse en ~500 ms qui aurait dû renvoyer
      //     un payload OK si le paiement existe vraiment côté Stripe),
      //   - pris l'accès basé sur le payload Stripe en filet « optimiste »,
      //   - pollé la DB en filet ultime si Stripe lui-même n'a rien répondu.
      // Si AUCUN de ces filets ne donne un abo, c'est presque toujours que
      // l'utilisateur n'a pas réellement payé (il a abandonné le checkout
      // ou fermé la page Stripe), ou que la session_id est invalide. On
      // refuse l'accès — c'est ce qui empêche un visiteur qui n'a pas
      // finalisé son paiement d'arriver dans l'interface payante.
      if (!hasPaidGoMythoAccess(dbUser)) {
        try {
          sessionStorage.setItem(
            NO_SUBSCRIPTION_FLAG_KEY,
            expectsWebhook
              ? "Stripe n'a pas confirmé ce paiement pour le moment. Si tu viens de payer, attends quelques secondes et reconnecte-toi. Sinon, choisis une offre pour activer ton compte."
              : "Ce compte n'a pas d'abonnement actif. Choisis une offre pour commencer.",
          )
        } catch { /* ignore */ }
        try { localStorage.removeItem('gomytho_pending_plan') } catch { /* ignore */ }
        clearPendingStripeSessionId()
        try { await supabase.auth.signOut() } catch { /* ignore */ }
        window.location.replace('/login')
        return
      }

      // Abo confirmé → purge les flags d'attente post-checkout
      try { localStorage.removeItem('gomytho_pending_plan') } catch { /* ignore */ }
      clearPendingStripeSessionId()

      // ─── 4. Construction de l'objet user (DB > cache local > défaut) ────────
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

      // ─── 5. Auto-génération si fresh payment + pending photos ─────────────
      if (hasPending && expectsWebhook) {
        setAutoGen(true)
        await tryAutoGenerate(authUser.id)
        setAutoGen(false)
        navigate('/makemytho', { replace: true })
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
          {autoGen && <p className="text-text-secondary text-sm">Environ 2 minutes, merci de patienter et ne ferme pas cette page</p>}
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
