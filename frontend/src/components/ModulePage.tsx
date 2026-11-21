// NULL design system — generic module page.
// The redesigned view every module section renders through: header
// card (title, description, subsection tabs, summary strip, Add/Edit
// box), then a DataTable driven by the section's ModulePresentation.
// All data callbacks arrive as props from App.tsx — this component
// never fetches and never reimplements them. Role gating and the
// scheduler's read-only behaviour match App.tsx exactly; the only
// visual change is the shared components (Tabs, KpiPanel, DataTable,
// StatusBadge / SeverityBadge, EmptyState) in place of the old inline
// pills, raw stats grid, and plain table.

import { useState } from 'react'
import { DataTable } from './DataTable'
import type { DataTableColumn } from './DataTable'
import { KpiPanel } from './KpiPanel'
import { StatusBadge, SeverityBadge } from './StatusBadge'
import { Tabs } from './Tabs'
import { EmptyState } from './EmptyState'
import { RecordDetailDrawer } from './RecordDetailDrawer'
import { formatLocalDateTime } from '../time'
import type { ModuleColumn, ModulePresentation } from '../modulePresentation'

export type ModulePageProps = {
  moduleId: string
  title: string
  description: string
  subsections: { id: string; label: string; endpoint: string }[]
  activeSubsectionId: string
  onSubsectionChange: (id: string) => void
  endpoint: string
  items: any[]
  stats: Record<string, any>
  presentation: ModulePresentation
  canWrite: boolean
  canDelete: boolean
  canRunCommands: boolean
  isScheduler: boolean
  editingId: string | null
  newName: string
  onNewNameChange: (v: string) => void
  onCreate: () => void
  onCancelEdit: () => void
  onEdit: (item: any) => void
  onDelete: (item: any) => void
  onSetStatus: (item: any, status: string) => void
  workflowButtons: (item: any) => { label: string; action: string }[]
  onWorkflow: (action: string, item: any) => void
  onViewDevice: (item: any) => void
  onSendConfig: (item: any) => void
  onRunSchedulerNow: () => void
  statusOptions: string[]
  deviceStatusOptions: string[]
}

// Same display-name fallback chain App.tsx uses.
function displayName(item: any): string {
  return item.title || item.name || item.hostname || item.cve_id || item.software_name || item.app_name || item.device_id || item.id
}

// Same detail fallback chain App.tsx uses, for non-device modules.
function displayDetail(item: any): string {
  return item.severity || item.category || item.platform || item.rule_type || item.scope || item.benchmark || item.detection_layer || item.event_type || item.action || item.status || ''
}

// Endpoints detail, read from the list row itself — no per-row fetch.
// DeviceOut (devices.py) returns `attributes: dict`, stamped by the
// inventory upload: attributes.os is the agent's OS dict
// ({name, version, platform, arch} — e.g. name "macOS", version
// "26.6.2") and attributes.software is the app COUNT (a number —
// `attrs["software"] = len(req.software or [])`), not the list.
// Older / manually added rows may carry neither, so fall back to the
// flat item.os / item.platform string fields, then '—'.
function deviceDetail(item: any): string {
  const attrs = (item.attributes && typeof item.attributes === 'object' ? item.attributes : {}) as Record<string, any>
  const parts: string[] = []

  const os = attrs.os
  let osText = ''
  if (os && typeof os === 'object') {
    const name = typeof os.name === 'string' && os.name ? os.name : typeof os.platform === 'string' ? os.platform : ''
    const version = typeof os.version === 'string' && os.version ? os.version : ''
    osText = [name, version].filter(Boolean).join(' ')
  } else if (typeof os === 'string' && os) {
    osText = os
  }
  if (!osText) {
    osText = typeof item.os === 'string' && item.os
      ? item.os
      : typeof item.platform === 'string'
        ? item.platform
        : ''
  }
  if (osText) parts.push(osText)

  const software = attrs.software
  const appCount =
    typeof software === 'number'
      ? software
      : Array.isArray(software)
        ? software.length
        : Array.isArray(item.software)
          ? item.software.length
          : null
  if (appCount !== null) parts.push(`${appCount} app${appCount === 1 ? '' : 's'}`)

  return parts.length > 0 ? parts.join(' · ') : '—'
}

export function ModulePage(props: ModulePageProps) {
  const {
    moduleId,
    title,
    description,
    subsections,
    activeSubsectionId,
    onSubsectionChange,
    endpoint,
    items,
    stats,
    presentation,
    canWrite,
    canDelete,
    canRunCommands,
    isScheduler,
    editingId,
    newName,
    onNewNameChange,
    onCreate,
    onCancelEdit,
    onEdit,
    onDelete,
    onSetStatus,
    workflowButtons,
    onWorkflow,
    onViewDevice,
    onSendConfig,
    onRunSchedulerNow,
    statusOptions,
    deviceStatusOptions,
  } = props

  // Generic record drill-down. Devices open the endpoint drawer
  // instead (onViewDevice), which App.tsx already owns.
  const [detailRecord, setDetailRecord] = useState<any | null>(null)

  // Summary strip: only stats the presentation labels, at most 4,
  // no invented trends. Omitted entirely when nothing is labelled.
  const labelledStats = Object.entries(presentation.statLabels)
    .filter(([key]) => stats[key] !== undefined && stats[key] !== null)
    .slice(0, 4)

  const openRecord = (item: any) => {
    if (moduleId === 'devices') {
      onViewDevice(item)
    } else {
      setDetailRecord(item)
    }
  }

  const renderCell = (col: ModuleColumn, item: any) => {
    const value = item[col.key]
    switch (col.kind) {
      case 'name':
        return (
          <button
            type="button"
            onClick={() => openRecord(item)}
            className="text-left font-medium text-null-tealDark hover:underline"
          >
            {displayName(item)}
          </button>
        )
      case 'detail': {
        const text = moduleId === 'devices' ? deviceDetail(item) : displayDetail(item)
        return <span className="text-null-muted dark:text-[#8AA0B8]">{text || '—'}</span>
      }
      case 'status': {
        // Devices carry their workflow state in enrollment_status,
        // not status — same as App.tsx.
        const effStatus = item.status || item.enrollment_status || ''
        if (isScheduler) {
          return <StatusBadge value={effStatus} />
        }
        const options = moduleId === 'devices' ? deviceStatusOptions : statusOptions
        return (
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge value={effStatus} />
            <select
              className="null-input !w-auto px-2 py-1 text-xs"
              value={effStatus}
              onChange={(e) => onSetStatus(item, e.target.value)}
              aria-label={`Status for ${displayName(item)}`}
              disabled={!canWrite}
            >
              <option value="">{effStatus || '—'}</option>
              {options
                .filter((s) => s !== effStatus)
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </select>
          </span>
        )
      }
      case 'severity':
        return <SeverityBadge value={typeof value === 'string' ? value : value == null ? '' : String(value)} />
      case 'date': {
        if (typeof value !== 'string' || !value) return '—'
        // formatLocalDateTime parses the naive-UTC backend value as
        // UTC (via parseBackendDate) and renders it viewer-local.
        return formatLocalDateTime(value)
      }
      case 'text':
      default:
        return String(value ?? '—')
    }
  }

  const columns: DataTableColumn<any>[] = [
    ...presentation.columns.map((col) => ({
      key: col.key,
      label: col.label,
      // Only kinds whose rendered value matches the raw key sort
      // meaningfully; 'name' renders displayName (title || name ||
      // hostname …), not the raw key, so it stays unsorted.
      sortable: col.kind === 'text' || col.kind === 'date',
      render: (row: any) => renderCell(col, row),
    })),
    {
      key: '__actions',
      label: 'Actions',
      render: (item: any) => (
        <div className="flex flex-wrap gap-1">
          {moduleId === 'devices' && (
            <button
              type="button"
              className="border border-null-line rounded px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-null-navy2"
              onClick={() => onViewDevice(item)}
            >
              View details
            </button>
          )}
          {endpoint === '/api/v1/vulnerabilities/' && canRunCommands && (
            <button
              type="button"
              className="border border-null-line rounded px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-null-navy2"
              title="Queue a remediation configuration's script as an agent command on the affected endpoint"
              onClick={() => onSendConfig(item)}
            >
              Send config
            </button>
          )}
          {workflowButtons(item).map((b) => (
            <button
              key={b.action}
              type="button"
              className="border border-null-line rounded px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-null-navy2"
              onClick={() => onWorkflow(b.action, item)}
            >
              {b.label}
            </button>
          ))}
          {canWrite && !isScheduler && (
            <button
              type="button"
              className="border border-null-line rounded px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-null-navy2"
              onClick={() => onEdit(item)}
            >
              Edit
            </button>
          )}
          {canDelete && !isScheduler && (
            <button
              type="button"
              className="border rounded px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-null-navy2"
              style={{ borderColor: '#E5AFB0', color: '#C64D4D' }}
              onClick={() => onDelete(item)}
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <div className="null-card mb-6">
        <h2 className="text-lg font-semibold mb-1 text-null-ink dark:text-white">{title}</h2>
        <p className="text-sm text-null-muted dark:text-[#8AA0B8] mb-4">{description}</p>
        {subsections.length > 0 && (
          <div className="mb-4">
            <Tabs
              items={subsections.map((s) => ({ id: s.id, label: s.label }))}
              active={activeSubsectionId}
              onChange={onSubsectionChange}
            />
          </div>
        )}
        {labelledStats.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {labelledStats.map(([key, value]) => (
              <KpiPanel key={key} label={presentation.statLabels[key]} value={String(value)} />
            ))}
          </div>
        )}
        {/* The scheduler is read-only (runs list only): no Add box,
            just the Run now button. The Add box is also hidden for
            roles that cannot write. */}
        {!isScheduler && canWrite && (
          <div className="flex gap-2 mt-4">
            <input
              className="null-input flex-1 p-2 text-sm"
              placeholder={editingId ? 'Edit record name / title' : 'New record name / title'}
              value={newName}
              onChange={(e) => onNewNameChange(e.target.value)}
            />
            <button
              type="button"
              className="bg-null-teal hover:bg-null-tealDark text-white px-4 rounded text-sm font-medium"
              onClick={onCreate}
            >
              {editingId ? 'Save' : 'Add'}
            </button>
            {editingId && (
              <button type="button" className="border border-null-line rounded px-4 text-sm" onClick={onCancelEdit}>
                Cancel
              </button>
            )}
          </div>
        )}
        {isScheduler && (
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              className="text-white px-4 py-2 rounded text-sm font-medium"
              style={{ background: '#218568' }}
              onClick={onRunSchedulerNow}
            >
              Run now
            </button>
          </div>
        )}
      </div>

      <div className="null-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="font-semibold text-null-ink dark:text-white">Items</h3>
          <span className="text-sm text-null-muted dark:text-[#8AA0B8]">
            {items.length} record{items.length === 1 ? '' : 's'}
          </span>
        </div>
        <DataTable
          columns={columns}
          rows={items}
          search
          emptyState={<EmptyState title={presentation.emptyTitle} description={presentation.emptyDescription} />}
        />
      </div>

      <RecordDetailDrawer
        open={!!detailRecord}
        record={detailRecord}
        title={detailRecord ? displayName(detailRecord) : ''}
        fields={presentation.detailFields}
        onClose={() => setDetailRecord(null)}
      />
    </div>
  )
}
