import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

const navItems = [
  { to: '/admin', icon: '📊', label: 'Vue d\'ensemble', end: true },
  { to: '/admin/users', icon: '👥', label: 'Utilisateurs' },
  { to: '/admin/mythos', icon: '🎨', label: 'Analyses' },
  { to: '/admin/finance', icon: '💰', label: 'Finances' },
  { to: '/admin/settings', icon: '⚙️', label: 'Paramètres' },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Vérifie si l'admin est connecté en essayant d'accéder au dashboard
    fetch('/api/admin/dashboard', { credentials: 'include' })
      .then(r => {
        if (r.status === 401) navigate('/admin-login')
        else {
          setChecking(false)
          // Réparation silencieuse en arrière-plan : rapatrie d'éventuelles
          // analyses faites avant l'ajout du miroir SQL et active les comptes
          // payants oubliés. Ne bloque jamais l'affichage.
          // Une seule fois par session navigateur (clé sessionStorage).
          try {
            const KEY = 'gomytho_admin_synced'
            if (!sessionStorage.getItem(KEY)) {
              sessionStorage.setItem(KEY, '1')
              fetch('/api/admin/migrate', { credentials: 'include' }).catch(() => {})
            }
          } catch { /* ignore */ }
        }
      })
      .catch(() => navigate('/admin-login'))
  }, [navigate])

  const handleLogout = async () => {
    await fetch('/api/admin-logout', { method: 'POST', credentials: 'include' })
    navigate('/admin-login')
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-primary-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-primary-bg flex">
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full z-30 flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:flex ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ width: '220px', background: '#0D1120', borderRight: '1px solid rgba(198,255,60,0.08)' }}
      >
        <div className="px-5 py-5 border-b" style={{ borderColor: 'rgba(198,255,60,0.08)' }}>
          <span className="text-xl font-black text-lime">GoMytho</span>
          <p className="text-[10px] text-text-secondary uppercase tracking-widest mt-0.5">Admin</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-lime/10 text-lime'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t" style={{ borderColor: 'rgba(198,255,60,0.08)' }}>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-all"
          >
            <span>🚪</span> Déconnexion
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar mobile */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'rgba(198,255,60,0.08)', background: '#0D1120' }}>
          <button onClick={() => setSidebarOpen(true)} className="text-text-secondary p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <span className="font-black text-lime">GoMytho Admin</span>
        </div>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
