import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Create from './pages/Create'
import Analyzing from './pages/Analyzing'
import Unlock from './pages/Unlock'
import Signup from './pages/Signup'
import App as Dashboard from './pages/App'
import Creations from './pages/Creations'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/create" element={<Create />} />
      <Route path="/analyzing" element={<Analyzing />} />
      <Route path="/unlock" element={<Unlock />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/app" element={<Dashboard />} />
      <Route path="/app/creations" element={<Creations />} />
    </Routes>
  )
}

export default App
