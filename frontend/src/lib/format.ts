// The backend stores UTC times without a timezone marker.
export function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : value + 'Z')
}

export const ONLINE_WINDOW_MS = 60 * 60 * 1000

export function isOnline(lastCheckin: string | null | undefined): boolean {
  const d = parseUtc(lastCheckin)
  return !!d && Date.now() - d.getTime() < ONLINE_WINDOW_MS
}

export function timeAgo(value: string | null | undefined): string {
  const d = parseUtc(value)
  if (!d) return 'Never'
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  if (s < 60) return 'Just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const days = Math.round(h / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function formatDate(value: string | null | undefined): string {
  const d = parseUtc(value)
  return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not reported'
}

export const ACTIVITY_LABELS: Record<string, string> = {
  'device.enrolled': 'New endpoint enrolled',
  'device.reenrolled': 'Endpoint re-enrolled',
  'device.stale': 'Endpoint stopped checking in',
  'group.created': 'Group created',
}
