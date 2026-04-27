import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, User } from '@/lib/supabase'

const PLAN_CREDITS: Record<string, number> = { weekly: 70, monthly: 610, free: 3 }

export interface AppUser extends User {}

export default function AppLayout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          navigate('/login')
          return
        }
        const authUser = session.user
        const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
        if (data) {
          setUser(data)
        } else {
          // 1er login (ex: Google OAuth) — lire le plan depuis l'URL (?plan=weekly/monthly)
          const planParam = searchParams.get('plan') || 'monthly'
          const plan = PLAN_CREDITS[planParam] ? planParam : 'monthly'
          const credits = PLAN_CREDITS[plan]
          const newUser = { id: authUser.id, email: authUser.email!, credits_remaining: credits, subscription_status: 'active', plan }
          await supabase.from('users').upsert([newUser], { onConflict: 'id' })
          setUser(newUser as any)
        }
      } catch {
        navigate('/login')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [navigate, searchParams])

  if (loading) {
    return (
      <div className="min-h-screen bg-primary-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime" />
      </div>
    )
  }

  const tabs = [
    { to: '/app', icon: '🎨', label: 'Créations', end: true },
    { to: '/app/new', icon: '✨', label: 'Créer' },
    { to: '/app/settings', icon: '⚙️', label: 'Paramètres' },
  ]

  return (
    <div className="min-h-screen bg-primary-bg flex flex-col">
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3"
        style={{ background: 'rgba(10,14,26,0.95)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(198,255,60,0.08)' }}>
        <span className="text-xl font-black text-lime">GoMytho</span>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold"
          style={{ background: 'rgba(198,255,60,0.08)', border: '1px solid rgba(198,255,60,0.2)' }}>
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
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex"
        style={{ background: 'rgba(10,14,26,0.97)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(198,255,60,0.08)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-all ${isActive ? '' : 'opacity-40'}`
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
