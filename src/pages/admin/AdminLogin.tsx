import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AdminLogin() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok && data.success) {
        navigate('/admin')
      } else {
        setError(data.error || 'Accès refusé')
      }
    } catch {
      setError('Erreur de connexion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-lime mb-1">GoMytho</h1>
          <p className="text-xs text-text-secondary uppercase tracking-widest">Panel Admin</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl p-6" style={{ background: '#141826', border: '1px solid rgba(198,255,60,0.1)' }}>
          <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
            Mot de passe
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full px-4 py-3 rounded-xl text-text-primary bg-primary-bg border mb-4 focus:outline-none transition-all"
            style={{ borderColor: error ? 'rgba(239,68,68,0.5)' : 'rgba(198,255,60,0.15)' }}
            onFocus={e => (e.target.style.borderColor = 'rgba(198,255,60,0.5)')}
            onBlur={e => (e.target.style.borderColor = error ? 'rgba(239,68,68,0.5)' : 'rgba(198,255,60,0.15)')}
            autoFocus
          />

          {error && (
            <p className="text-red-400 text-sm mb-4 flex items-center gap-2">
              <span>⚠️</span> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 font-black rounded-xl bg-lime text-primary-bg transition-all active:scale-95 disabled:opacity-40"
          >
            {loading ? 'Vérification...' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
