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

export function formatDay(value: string | null | undefined): string {
  if (!value) return 'Not set'
  const d = value.length <= 10 ? new Date(value + 'T00:00:00') : parseUtc(value)
  return d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Not set'
}

export function timeUntil(value: string | null | undefined): string {
  const d = parseUtc(value)
  if (!d) return ''
  const mins = Math.round((d.getTime() - Date.now()) / 60000)
  const abs = Math.abs(mins)
  const txt = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} hr` : `${Math.round(abs / 1440)} days`
  return mins < 0 ? `${txt} overdue` : `in ${txt}`
}

Object.assign(ACTIVITY_LABELS, {
  'vulnerability.remediated': 'Vulnerability marked fixed',
  'vulnerability.accepted': 'Vulnerability risk accepted',
  'vulnerability.open': 'Vulnerability reopened',
  'patch.approved': 'Patch approved',
  'patch.declined': 'Patch declined',
  'patch.pending': 'Patch moved back to pending',
  'deployment.scheduled': 'Patch deployment scheduled',
  'deployment.completed': 'Patch deployment finished',
  'policy.created': 'Deployment policy created',
  'policy.updated': 'Deployment policy updated',
  'software.approved': 'Software approved',
  'software.unapproved': 'Software marked unapproved',
  'software.unreviewed': 'Software rule removed',
  'ticket.created': 'Ticket opened',
  'ticket.updated': 'Ticket updated',
  'workflow.created': 'Workflow created',
  'workflow.updated': 'Workflow updated',
  'workflow.ran': 'Workflow ran',
  'control.updated': 'Compliance control updated',
  'risk.created': 'Risk added',
  'risk.updated': 'Risk updated',
  'warranty.updated': 'Warranty updated',
  'warranty.imported': 'Warranty data imported',
})
