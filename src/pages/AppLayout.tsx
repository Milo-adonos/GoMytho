import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase, User } from '@/lib/supabase'

export interface AppUser extends User {}

export default function AppLayout() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      try {
        // Récupère la session (gère aussi le callback OAuth avec token dans l'URL)
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          navigate('/signup')
          return
        }
        const authUser = session.user
        const { data } = await supabase.from('users').select('*').eq('id', authUser.id).single()
        if (data) {
          setUser(data)
        } else {
          // Créer le profil si inexistant (ex: 1er login Google)
          const newUser = { id: authUser.id, email: authUser.email!, credits_remaining: 610, subscription_status: 'active', plan: 'monthly' }
          await supabase.from('users').upsert([newUser], { onConflict: 'id' })
          setUser(newUser as any)
        }
      } catch {
        navigate('/signup')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [navigate])

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
