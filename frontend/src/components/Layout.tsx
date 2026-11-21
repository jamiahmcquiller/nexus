import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Monitor, PackageCheck, ShieldAlert, AppWindow, LifeBuoy, Workflow,
  ShieldCheck, BarChart3, Users, Settings, LogOut, Menu, X, Search, Bell,
} from 'lucide-react'
import { api } from '../lib/api'

type NavItem = { to: string; label: string; icon: typeof Monitor; soon?: boolean; adminOnly?: boolean }

const WORKSPACE: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/endpoints', label: 'Endpoint Management', icon: Monitor },
  { to: '/patches', label: 'Patch Management', icon: PackageCheck },
  { to: '/vulnerabilities', label: 'Vulnerability Management', icon: ShieldAlert },
  { to: '/software', label: 'Software Management', icon: AppWindow },
  { to: '/service-desk', label: 'Service Desk', icon: LifeBuoy },
  { to: '/automation', label: 'Automation', icon: Workflow },
  { to: '/compliance', label: 'Security & Compliance', icon: ShieldCheck },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
]

const ADMIN: NavItem[] = [
  { to: '/admin/users', label: 'Users & Roles', icon: Users, soon: true, adminOnly: true },
  { to: '/admin/settings', label: 'Settings', icon: Settings, soon: true, adminOnly: true },
]

export type Org = { name: string; has_sample_data?: boolean; user: { username: string; role: string } }

function NavSection({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate: () => void }) {
  return (
    <div className="mb-6">
      <p className="px-3 mb-2 text-[10px] font-semibold tracking-[0.14em] text-navy-300/70 uppercase">{title}</p>
      <ul className="space-y-0.5">
        {items.map(({ to, label, icon: Icon, soon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  isActive
                    ? 'bg-white/10 text-white font-medium shadow-[inset_2px_0_0_0_#2BB3B8]'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={17} strokeWidth={1.8} className="shrink-0" />
              <span className="truncate">{label}</span>
              {soon && <span className="ml-auto text-[10px] text-navy-300/60 group-hover:text-navy-300">Soon</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Layout() {
  const [org, setOrg] = useState<Org | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/organization').then(r => setOrg(r.data)).catch(() => {})
  }, [])

  const isAdmin = org ? ['owner', 'admin'].includes(org.user.role) : false
  const signOut = () => {
    localStorage.removeItem('nexus_token')
    navigate('/login')
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-navy">
      <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal text-white font-bold text-sm">N</div>
        <div className="leading-tight">
          <p className="text-white font-semibold tracking-wide text-sm">NEXUS</p>
          <p className="text-[10px] tracking-[0.12em] text-navy-300 uppercase">IT Operations Platform</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <NavSection title="Workspace" items={WORKSPACE} onNavigate={() => setMobileOpen(false)} />
        {isAdmin && <NavSection title="Administration" items={ADMIN} onNavigate={() => setMobileOpen(false)} />}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-navy-700 text-xs font-semibold text-white uppercase">
            {org?.user.username.slice(0, 2) ?? '..'}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] text-white">{org?.user.username}</p>
            <p className="truncate text-[11px] text-navy-300 capitalize">{org?.user.role}</p>
          </div>
          <button onClick={signOut} title="Sign out" className="rounded-md p-1.5 text-navy-300 hover:bg-white/10 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden lg:block w-64 shrink-0 print:hidden">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-64">{sidebar}</div>
          <button className="absolute top-4 left-[17rem] text-white" onClick={() => setMobileOpen(false)}><X /></button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="print:hidden flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button className="lg:hidden rounded-md p-1.5 text-slate-600 hover:bg-slate-100" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="relative hidden md:block w-full max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search devices by hostname, serial, or user"
              onKeyDown={e => {
                const v = (e.target as HTMLInputElement).value.trim()
                if (e.key === 'Enter') navigate(`/endpoints${v ? `?q=${encodeURIComponent(v)}` : ''}`)
              }}
              className="w-full rounded-lg border border-slate-200 bg-cloud py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-teal focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/15"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center rounded-md bg-cloud px-2.5 py-1 text-xs font-medium text-slate-600">
              {org?.name}
            </span>
            <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Alerts">
              <Bell size={18} />
            </button>
          </div>
        </header>
        {org?.has_sample_data && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-800 print:hidden">
            This organization includes sample devices and data for demonstration. Real devices appear alongside them once the agent is installed.
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <Outlet context={org} />
          </div>
        </main>
      </div>
    </div>
  )
}
