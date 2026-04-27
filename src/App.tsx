import { Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'

// Lazy load pour éviter les erreurs de chargement initial
const Landing = lazy(() => import('./pages/Landing'))
const Create = lazy(() => import('./pages/Create'))
const Analyzing = lazy(() => import('./pages/Analyzing'))
const Unlock = lazy(() => import('./pages/Unlock'))
const Signup = lazy(() => import('./pages/Signup'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Creations = lazy(() => import('./pages/Creations'))

// Admin
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminMythos = lazy(() => import('./pages/admin/AdminMythos'))
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance'))
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'))

// Fallback de chargement
const LoadingFallback = () => (
  <div className="min-h-screen bg-primary-bg flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lime mx-auto mb-4" />
      <p className="text-text-secondary">Chargement...</p>
    </div>
  </div>
)

function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create" element={<Create />} />
        <Route path="/analyzing" element={<Analyzing />} />
        <Route path="/unlock" element={<Unlock />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/app" element={<Dashboard />} />
        <Route path="/app/creations" element={<Creations />} />

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
