import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { capturePageview } from './lib/analytics'

const Landing = lazy(() => import('./pages/Landing'))
const Create = lazy(() => import('./pages/Create'))
const Analyzing = lazy(() => import('./pages/Analyzing'))
const Unlock = lazy(() => import('./pages/Unlock'))
const Signup = lazy(() => import('./pages/Signup'))
const Login = lazy(() => import('./pages/Login'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))

// App interne
const AppLayout = lazy(() => import('./pages/AppLayout'))
const AppCreations = lazy(() => import('./pages/AppCreations'))
const AppCreate = lazy(() => import('./pages/AppCreate'))
const AppSettings = lazy(() => import('./pages/AppSettings'))

// Admin
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminMythos = lazy(() => import('./pages/admin/AdminMythos'))
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'))

const LoadingFallback = () => (
  <div className="min-h-screen bg-primary-bg flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lime mx-auto mb-4" />
      <p className="text-text-secondary">Chargement...</p>
    </div>
  </div>
)

function PageviewTracker() {
  const location = useLocation()
  useEffect(() => {
    capturePageview()
  }, [location.pathname, location.search])
  return null
}

function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PageviewTracker />
      <Routes>
        {/* Funnel public */}
        <Route path="/" element={<Landing />} />
        <Route path="/uploadphoto" element={<Create />} />
        <Route path="/chargementmytho" element={<Analyzing />} />
        <Route path="/choixoffre" element={<Unlock />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* App interne — layout avec bottom nav */}
        <Route element={<AppLayout />}>
          <Route path="/resultats" element={<AppCreations />} />
          <Route path="/makemytho" element={<AppCreate />} />
          <Route path="/settings" element={<AppSettings />} />
        </Route>

        {/* Redirections des anciennes URLs */}
        <Route path="/create" element={<Navigate to="/uploadphoto" replace />} />
        <Route path="/analyzing" element={<Navigate to="/chargementmytho" replace />} />
        <Route path="/unlock" element={<Navigate to="/choixoffre" replace />} />
        <Route path="/app" element={<Navigate to="/resultats" replace />} />
        <Route path="/app/dashboard" element={<Navigate to="/makemytho" replace />} />
        <Route path="/app/new" element={<Navigate to="/makemytho" replace />} />
        <Route path="/app/settings" element={<Navigate to="/settings" replace />} />
        <Route path="/app/creations" element={<Navigate to="/resultats" replace />} />
        <Route path="/dashboard" element={<Navigate to="/makemytho" replace />} />
        <Route path="/creations" element={<Navigate to="/resultats" replace />} />

        {/* Admin */}
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="mythos" element={<AdminMythos />} />
          <Route path="finance" element={<AdminFinance />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
