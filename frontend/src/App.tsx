import { useState, useEffect } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function App() {
  const [stats, setStats] = useState({ total: 0, online: 0, stale: 0 })
  const [devices, setDevices] = useState<any[]>([])
  const [token, setToken] = useState(localStorage.getItem('nexus_token') || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  useEffect(() => {
    if (token) {
      axios.get(`${API}/api/v1/devices/stats`, { headers })
        .then(r => setStats(r.data))
        .catch(() => setError('Failed to load stats'))
      axios.get(`${API}/api/v1/devices/`, { headers })
        .then(r => setDevices(r.data))
        .catch(() => {})
    }
  }, [token])

  const login = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/auth/token`, { email, password })
      const t = res.data.access_token
      setToken(t)
      localStorage.setItem('nexus_token', t)
      setError('')
    } catch {
      setError('Login failed')
    }
  }

  const register = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/auth/register`, {
        tenant_name: 'Demo Organization',
        email,
        password,
      })
      const t = res.data.access_token
      setToken(t)
      localStorage.setItem('nexus_token', t)
      setError('')
    } catch {
      setError('Registration failed')
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow w-96">
          <h1 className="text-2xl font-semibold mb-2">NEXUS</h1>
          <p className="text-sm text-gray-500 mb-6">Sign in to the console</p>
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          <input className="w-full border p-2 mb-3 rounded" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="w-full border p-2 mb-4 rounded" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="w-full bg-blue-600 text-white p-2 rounded mb-2" onClick={login}>Sign In</button>
          <button className="w-full border p-2 rounded" onClick={register}>Create Organization</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">NEXUS</h1>
          <p className="text-sm text-gray-500">IT Operations & Security Management</p>
        </div>
        <button className="text-sm text-gray-600" onClick={() => { setToken(''); localStorage.removeItem('nexus_token') }}>Sign out</button>
      </header>
      <main className="p-6">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-medium mb-4">Dashboard</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded p-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-sm text-gray-500">Endpoints</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-2xl font-bold text-green-600">{stats.online}</div>
              <div className="text-sm text-gray-500">Online</div>
            </div>
            <div className="border rounded p-4">
              <div className="text-2xl font-bold text-amber-600">{stats.stale}</div>
              <div className="text-sm text-gray-500">Stale</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium mb-4">Endpoints</h2>
          {devices.length === 0 ? (
            <p className="text-gray-500">No devices enrolled yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Hostname</th>
                  <th className="pb-2">Device ID</th>
                  <th className="pb-2">Last Check-in</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id} className="border-b">
                    <td className="py-2">{d.hostname || '—'}</td>
                    <td className="py-2 font-mono text-xs">{d.device_id}</td>
                    <td className="py-2">{d.last_checkin_at ? new Date(d.last_checkin_at).toLocaleString() : '—'}</td>
                    <td className="py-2">{d.enrollment_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
