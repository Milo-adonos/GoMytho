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
      </Routes>
    </Suspense>
  )
}

export default App
