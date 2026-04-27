import { useEffect, useState } from 'react'

export default function AdminSettings() {
  const [costPerImage, setCostPerImage] = useState('0.037')
  const [notifEmail, setNotifEmail] = useState('')
  const [maintenance, setMaintenance] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setCostPerImage(String(d.costPerImage))
        setNotifEmail(d.notificationEmail || '')
        setMaintenance(d.maintenanceMode || false)
      })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ costPerImage: parseFloat(costPerImage), notificationEmail: notifEmail, maintenanceMode: maintenance }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputCls = "w-full px-4 py-3 rounded-xl text-sm text-text-primary bg-primary-bg border focus:outline-none transition-all"
  const inputStyle = { borderColor: 'rgba(198,255,60,0.15)' }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-xl font-black text-white">Paramètres</h1>

      {/* Coût IA */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-sm font-bold text-white">Coût IA</p>
        <div>
          <label className="block text-xs text-text-secondary mb-1.5">Coût par image (€)</label>
          <input type="number" step="0.001" value={costPerImage} onChange={e => setCostPerImage(e.target.value)} className={inputCls} style={inputStyle} />
          <p className="text-xs text-text-secondary mt-1">Tarif Kie.ai actuel : 0,037€ / image en 1K</p>
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-sm font-bold text-white">Notifications</p>
        <div>
          <label className="block text-xs text-text-secondary mb-1.5">Email de notification</label>
          <input type="email" value={notifEmail} onChange={e => setNotifEmail(e.target.value)} placeholder="admin@gomytho.com" className={inputCls} style={inputStyle} />
        </div>
      </div>

      {/* Mot de passe */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-sm font-bold text-white">Mot de passe admin</p>
        <div>
          <label className="block text-xs text-text-secondary mb-1.5">Nouveau mot de passe</label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" className={`${inputCls} pr-12`} style={inputStyle} />
            <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary text-xs">
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
          <p className="text-xs text-text-secondary mt-1">⚠️ Le nouveau mot de passe doit être mis à jour dans <code className="text-lime">.env</code> et Vercel</p>
        </div>
      </div>

      {/* Mode maintenance */}
      <div className="rounded-2xl p-5" style={{ background: '#141826', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">Mode maintenance</p>
            <p className="text-xs text-text-secondary mt-0.5">Désactive les nouvelles inscriptions temporairement</p>
          </div>
          <button
            onClick={() => setMaintenance(m => !m)}
            className="w-12 h-6 rounded-full transition-all relative"
            style={{ background: maintenance ? '#C6FF3C' : '#2d3148' }}
          >
            <span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all" style={{ left: maintenance ? '26px' : '4px' }} />
          </button>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl font-black bg-lime text-primary-bg transition-all active:scale-95 disabled:opacity-50">
        {saving ? 'Sauvegarde...' : saved ? '✓ Sauvegardé !' : 'Sauvegarder les paramètres'}
      </button>
    </div>
  )
}
