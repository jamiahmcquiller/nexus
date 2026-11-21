import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Monitor, Activity } from 'lucide-react'
import { api } from '../lib/api'
import { Button } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'create'>('signin')
  const [orgName, setOrgName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = mode === 'signin'
        ? await api.post('/auth/token', { username, password })
        : await api.post('/auth/register', { tenant_name: orgName || 'My Organization', username, password })
      localStorage.setItem('nexus_token', res.data.access_token)
      navigate('/')
    } catch {
      setError(mode === 'signin' ? 'That username and password did not match.' : 'Could not create the organization. Try a different username.')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/15'

  return (
    <div className="flex min-h-full">
      <div className="relative hidden lg:flex w-[46%] flex-col justify-between overflow-hidden bg-navy p-12 text-white">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-teal/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-teal font-bold">N</div>
          <div className="leading-tight">
            <p className="font-semibold tracking-wide">NEXUS</p>
            <p className="text-[10px] tracking-[0.14em] text-navy-300 uppercase">IT Operations Platform</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Unified IT Operations &amp; Security Management</h1>
          <p className="mt-4 text-navy-300">Every device, patch, and security finding across your organization, in one place.</p>
          <ul className="mt-10 space-y-4 text-sm">
            {[
              [Monitor, 'Live inventory of every enrolled endpoint'],
              [Activity, 'Check-in monitoring that flags silent devices'],
              [ShieldCheck, 'Built security-first, with full audit history'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Monitor
              return (
                <li key={i} className="flex items-center gap-3 text-slate-200">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10"><I size={16} /></span>
                  {text as string}
                </li>
              )
            })}
          </ul>
        </div>
        <p className="relative text-xs text-navy-300">© {new Date().getFullYear()} NEXUS</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-cloud px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-navy font-bold text-white">N</div>
            <p className="font-semibold tracking-wide text-navy">NEXUS</p>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">
            {mode === 'signin' ? 'Sign in to your console' : 'Create your organization'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'signin' ? 'Welcome back. Enter your details to continue.' : 'Set up a workspace and its first administrator.'}
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === 'create' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Organization name</label>
                <input className={input} value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Acme Corporation" />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
              <input className={input} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
              <input className={input} type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full py-2.5">
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create organization'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            {mode === 'signin' ? 'New to NEXUS? ' : 'Already have an account? '}
            <button className="font-medium text-teal hover:text-teal-700" onClick={() => { setMode(mode === 'signin' ? 'create' : 'signin'); setError('') }}>
              {mode === 'signin' ? 'Create an organization' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
