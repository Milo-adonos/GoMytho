import { useEffect, useState } from 'react'
import { NavLink, Outlet, useSearchParams } from 'react-router-dom'
import { supabase, User } from '@/lib/supabase'
import { generateMytho, uploadToSupabase } from '@/lib/kie-api'
import { saveMythoToCloud } from '@/lib/mythos-sync'
import type { AspectRatio } from '@/lib/kie-api'

const PLAN_CREDITS: Record<string, number> = { weekly: 160, monthly: 560, free: 3 }
const USE_USERS_TABLE = import.meta.env.VITE_USE_USERS_TABLE === 'true'

export interface AppUser extends User {}

async function tryAutoGenerate(userId: string) {
  const pendingImage = localStorage.getItem('gomytho_pending_image')
  const pendingPrompt = localStorage.getItem('gomytho_pending_prompt')
  const pendingRatio = (localStorage.getItem('gomytho_pending_ratio') || '9:16') as AspectRatio
  if (!pendingImage || !pendingPrompt) return
  try {
    const res = await fetch(pendingImage)
    const blob = await res.blob()
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    const publicUrl = await uploadToSupabase(file, userId)
    const { dataUrl } = await generateMytho(
      { userPrompt: pendingPrompt, imageUrl: publicUrl, aspectRatio: pendingRatio },
      () => {}
    )
    await saveMythoToCloud({ userId, generatedDataUrl: dataUrl, prompt: pendingPrompt })
    localStorage.removeItem('gomytho_pending_image')
    localStorage.removeItem('gomytho_pending_prompt')
    localStorage.removeItem('gomytho_pending_ratio')
    localStorage.removeItem('gomytho_pending_plan')
    window.location.href = '/resultats'
  } catch (err) {
    console.warn('Auto-génération échouée :', err)
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
  const [searchParams] = useSearchParams()
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoGen, setAutoGen] = useState(false)

  useEffect(() => {
    const init = async () => {
      // ── 1. Vérifier la session auth (CRITIQUE) ──────────────────────────
      const session = await waitForSession()

      if (!session) {
        window.location.href = '/login'
        return
      }

      const authUser = session.user

      // Mode sans table users (évite spam 404 si table absente)
      if (!USE_USERS_TABLE) {
        const cachedPlan = (localStorage.getItem('gomytho_user_plan') as 'weekly' | 'monthly' | null) || 'monthly'
        const cachedCredits = Number(localStorage.getItem('gomytho_user_credits') || PLAN_CREDITS[cachedPlan] || 0)
        setUser({
          id: authUser.id,
          email: authUser.email!,
          credits_remaining: Number.isFinite(cachedCredits) ? cachedCredits : 0,
          subscription_status: 'active',
          plan: cachedPlan,
          created_at: new Date().toISOString(),
        } as any)
        setLoading(false)
        return
      }

      // ── 2. Charger le profil depuis la DB (NON-CRITIQUE) ────────────────
      // Une erreur ici ne déconnecte PAS l'utilisateur
      try {
        const { data: dbUser } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single()

        const hasPending = !!(localStorage.getItem('gomytho_pending_image') && localStorage.getItem('gomytho_pending_prompt'))

        if (dbUser) {
          setUser(dbUser)
          localStorage.setItem('gomytho_user_plan', dbUser.plan || 'monthly')
          localStorage.setItem('gomytho_user_credits', String(dbUser.credits_remaining ?? 0))
          if (hasPending) { setAutoGen(true); tryAutoGenerate(authUser.id).finally(() => setAutoGen(false)) }
        } else {
          // Nouveau profil (premier login Google, etc.)
          const urlPlan = searchParams.get('plan')
          const storedPlan = localStorage.getItem('gomytho_pending_plan')
          const rawPlan = urlPlan || storedPlan || 'monthly'
          const plan = PLAN_CREDITS[rawPlan] ? rawPlan : 'monthly'
          const newUser = {
            id: authUser.id,
            email: authUser.email!,
            credits_remaining: PLAN_CREDITS[plan],
            subscription_status: 'active',
            plan,
            created_at: new Date().toISOString(),
          }
          supabase.from('users').upsert([newUser], { onConflict: 'id' }).then(() => {})
          setUser(newUser as any)
          localStorage.setItem('gomytho_user_plan', plan)
          localStorage.setItem('gomytho_user_credits', String(PLAN_CREDITS[plan]))
          if (hasPending) { setAutoGen(true); tryAutoGenerate(authUser.id).finally(() => setAutoGen(false)) }
        }
      } catch {
        // DB inaccessible → on affiche quand même l'app avec les infos auth de base
        const cachedPlan = (localStorage.getItem('gomytho_user_plan') as 'weekly' | 'monthly' | null) || 'monthly'
        const cachedCredits = Number(localStorage.getItem('gomytho_user_credits') || 0)
        setUser({
          id: authUser.id,
          email: authUser.email!,
          credits_remaining: Number.isFinite(cachedCredits) ? cachedCredits : 0,
          subscription_status: 'active',
          plan: cachedPlan,
          created_at: new Date().toISOString(),
        } as any)
      }

      setLoading(false)
    }

    init()
  }, [searchParams])

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
