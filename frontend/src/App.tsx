import { useState, useEffect } from 'react'
import axios from 'axios'

const API = (() => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host.includes('app.github.dev')) {
      // Codespaces port forwarding: replace the frontend port with 8000
      const origin = window.location.origin
      const backend = origin.replace(/-5173\.app\.github\.dev/, '-8000.app.github.dev')
      if (backend !== origin) return backend
      // Fallback: try replacing any port number
      return origin.replace(/-\d+\.app\.github\.dev/, '-8000.app.github.dev')
    }
  }
  return 'http://localhost:8000'
})()

// Debug helper — visible in console
if (typeof window !== 'undefined') {
  console.log('[NEXUS] API base URL:', API)
}

const MODULES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'devices', label: 'Endpoints' },
  { id: 'patches', label: 'Patch Management' },
  { id: 'vulnerabilities', label: 'Vulnerabilities' },
  { id: 'edr', label: 'Endpoint Detection & Response' },
  { id: 'malware', label: 'Malware Protection' },
  { id: 'ransomware', label: 'Anti-Ransomware' },
  { id: 'browser', label: 'Browser Security' },
  { id: 'appcontrol', label: 'Application Control' },
  { id: 'dlp', label: 'Data Security / DLP' },
  { id: 'access', label: 'Secure Private Access' },
  { id: 'assets', label: 'Asset Management' },
  { id: 'distribution', label: 'Application Distribution' },
  { id: 'dex', label: 'Digital Employee Experience' },
  { id: 'remote', label: 'Remote Access' },
  { id: 'imaging', label: 'OS Imaging' },
  { id: 'config', label: 'Configuration Management' },
  { id: 'mdm', label: 'Mobile Device Management' },
  { id: 'encryption', label: 'Disk Encryption' },
  { id: 'servers', label: 'Server Management' },
  { id: 'compliance', label: 'Compliance & Reporting' },
  { id: 'policies', label: 'Policies' },
]

function App() {
  const [token, setToken] = useState(localStorage.getItem('nexus_token') || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [module, setModule] = useState('dashboard')
  const [stats, setStats] = useState<any>({})
  const [items, setItems] = useState<any[]>([])

  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  useEffect(() => {
    if (!token) return
    const load = async () => {
      try {
        if (module === 'dashboard' || module === 'devices') {
          const s = await axios.get(`${API}/api/v1/devices/stats`, { headers })
          setStats(s.data)
          const d = await axios.get(`${API}/api/v1/devices/`, { headers })
          setItems(d.data)
        } else if (module === 'patches') {
          const s = await axios.get(`${API}/api/v1/patches/stats`, { headers })
          setStats(s.data)
          const d = await axios.get(`${API}/api/v1/patches/`, { headers })
          setItems(d.data)
        } else if (module === 'vulnerabilities') {
          const s = await axios.get(`${API}/api/v1/vulnerabilities/stats`, { headers })
          setStats(s.data)
          const d = await axios.get(`${API}/api/v1/vulnerabilities/`, { headers })
          setItems(d.data)
        } else if (module === 'edr' || module === 'malware' || module === 'ransomware') {
          const s = await axios.get(`${API}/api/v1/alerts/stats`, { headers })
          setStats(s.data)
          const d = await axios.get(`${API}/api/v1/alerts/`, { headers })
          setItems(d.data)
        } else if (module === 'compliance') {
          const d = await axios.get(`${API}/api/v1/compliance/`, { headers })
          setItems(d.data)
          setStats({ total: d.data.length })
        } else if (module === 'policies') {
          const d = await axios.get(`${API}/api/v1/policies/`, { headers })
          setItems(d.data)
          setStats({ total: d.data.length })
        } else {
          setStats({})
          setItems([])
        }
      } catch {
        setStats({})
        setItems([])
      }
    }
    load()
  }, [token, module])

  const login = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/auth/token`, { username, password })
      setToken(res.data.access_token)
      localStorage.setItem('nexus_token', res.data.access_token)
      setError('')
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Login failed'
      setError(`${typeof msg === 'string' ? msg : JSON.stringify(msg)} (API: ${API})`)
    }
  }

  const register = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/auth/register`, {
        tenant_name: 'Demo Organization',
        username,
        password,
      })
      setToken(res.data.access_token)
      localStorage.setItem('nexus_token', res.data.access_token)
      setError('')
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Registration failed'
      setError(`${typeof msg === 'string' ? msg : JSON.stringify(msg)} (API: ${API})`)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow w-96">
          <h1 className="text-2xl font-semibold mb-2">NEXUS</h1>
          <p className="text-sm text-gray-500 mb-6">Unified IT & Security Platform</p>
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          <input className="w-full border p-2 mb-3 rounded" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border p-2 mb-4 rounded" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="w-full bg-blue-600 text-white p-2 rounded mb-2" onClick={login}>Sign In</button>
          <button className="w-full border p-2 rounded" onClick={register}>Create Organization</button>
        </div>
      </div>
    )
  }

  const current = MODULES.find(m => m.id === module) || MODULES[0]

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-xl font-semibold">NEXUS</h1>
          <p className="text-xs text-gray-500">IT & Security Platform</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {MODULES.map(m => (
            <button
              key={m.id}
              onClick={() => setModule(m.id)}
              className={`w-full text-left px-3 py-2 rounded text-sm mb-1 ${module === m.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t">
          <button className="text-sm text-gray-600" onClick={() => { setToken(''); localStorage.removeItem('nexus_token') }}>Sign out</button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-medium mb-1">{current.label}</h2>
          <p className="text-sm text-gray-500 mb-4">Module foundation — data model and API ready. Full workflows in progress.</p>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(stats).map(([k, v]) => (
              <div key={k} className="border rounded p-4">
                <div className="text-2xl font-bold">{String(v)}</div>
                <div className="text-sm text-gray-500 capitalize">{k}</div>
              </div>
            ))}
            {Object.keys(stats).length === 0 && <div className="text-gray-400">No stats yet</div>}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-medium mb-3">Items</h3>
          {items.length === 0 ? (
            <p className="text-gray-500">No records yet. Endpoints, patches, vulnerabilities, and alerts will appear here once data is ingested.</p>
          ) : (
            <pre className="text-xs bg-gray-50 p-4 rounded overflow-auto max-h-96">{JSON.stringify(items, null, 2)}</pre>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
