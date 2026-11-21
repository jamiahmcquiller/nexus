import type { ReactNode } from 'react'
import { isOnline } from '../lib/format'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border border-slate-200 shadow-card ${className}`}>{children}</div>
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-slate-100">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

type Tone = 'green' | 'gray' | 'amber' | 'red' | 'teal' | 'navy'
const toneClasses: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  teal: 'bg-teal-50 text-teal-700 ring-teal-600/20',
  navy: 'bg-slate-100 text-navy ring-navy/20',
}

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}

export function StatusBadge({ lastCheckin }: { lastCheckin: string | null | undefined }) {
  const online = isOnline(lastCheckin)
  return (
    <Badge tone={online ? 'green' : 'gray'}>
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {online ? 'Online' : 'Offline'}
    </Badge>
  )
}

export function Button({
  children, onClick, variant = 'primary', type = 'button', disabled, className = '',
}: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost'
  type?: 'button' | 'submit'; disabled?: boolean; className?: string
}) {
  const styles = {
    primary: 'bg-teal text-white hover:bg-teal-700 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm',
    ghost: 'hover:bg-slate-100',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14">
      {icon && <div className="mb-3 rounded-full bg-teal-50 p-3 text-teal">{icon}</div>}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="text-sm text-slate-500 mt-1 max-w-sm">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 rounded-full border-2 border-slate-200 border-t-teal animate-spin" />
    </div>
  )
}

export const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'gray' | 'teal' | 'navy' | 'green'> = {
  critical: 'red', high: 'amber', important: 'amber', medium: 'navy', moderate: 'navy', low: 'gray',
}

export function SeverityBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <Badge>None</Badge>
  return <Badge tone={SEVERITY_TONE[value] ?? 'gray'}><span className="capitalize">{value}</span></Badge>
}

export function Stat({ label, value, sub, tone = 'text-slate-900' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${value === t.id ? 'border-teal font-medium text-teal' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs text-slate-400">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/50 p-4 pt-[10vh]" onClick={onClose}>
      <div className={`w-full ${width} rounded-xl bg-white shadow-xl`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-md px-2 text-xl leading-none text-slate-400 hover:text-slate-700">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/15'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Bar({ value, max = 100, tone = 'bg-teal' }: { value: number; max?: number; tone?: string }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return <div className="h-2 w-full rounded-full bg-slate-100"><div className={`h-2 rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div>
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {head.map((h, i) => <th key={i} className={`py-2.5 pr-4 ${i === 0 ? 'pl-5' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, first, className = '' }: { children?: ReactNode; first?: boolean; className?: string }) {
  return <td className={`py-3 pr-4 align-middle ${first ? 'pl-5' : ''} ${className}`}>{children}</td>
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [keys.map(esc).join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n')
}

export function downloadFile(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
