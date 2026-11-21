import type { Warranty } from './api'

// Mirrors the backend's classification so lists can show warranty status without an extra request.
export function parseDate(w?: Warranty): Warranty {
  if (!w?.end_date) return { ...w, status: 'unknown', days_left: null }
  const end = new Date(w.end_date.slice(0, 10) + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((end.getTime() - today.getTime()) / 86400000)
  return { ...w, days_left: days, status: days < 0 ? 'expired' : days <= 90 ? 'expiring' : 'active' }
}
