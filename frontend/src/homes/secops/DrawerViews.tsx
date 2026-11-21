// NULL — Security Operations home: drill-down drawer content.
//
// Every clickable surface on the SecOps home (KPI panels, chart
// segments, queue rows, vuln rows, timeline entries) opens the
// generic DetailDrawer with one of these views, so no click is
// ever dead: a list view shows the underlying records in a
// searchable/sortable DataTable, and each row opens its full
// record detail. Device rows go through onOpenDevice — the single
// choke point that opens the shared EndpointDetailDrawer
// (components/EndpointDetailDrawer.tsx); there is no generic
// device view here by design.
//
// Honesty rules enforced here, same as the home screen:
//  - Live vs Sample comes from the record's own is_demo flag.
//    Devices carry is_demo in DeviceOut; alerts and compliance
//    rows have no is_demo column, so they show no origin badge.
//  - Vulnerability attributes.due_at is NEVER shown (seed-only
//    synthetic, absent on real rows). Policy
//    definition.sample_violation_count / sample_violation_example
//    are NEVER shown — there is no violation record type.
//  - No field is shown that the record does not carry; missing
//    values render "—" with the reason stated where it matters.

import type { ReactNode } from 'react'
import { DataTable, SeverityBadge, StatusBadge } from '../../components'
import type { DataTableColumn } from '../../components'
import { NULL_COLORS } from '../../theme'
import {
  cvssOf,
  fmtAge,
  fmtDate,
  fmtDay,
  isSampleDevice,
  osLabelOf,
  parseDate,
  severityOf,
  timeOf,
} from './types'
import type {
  AlertRow,
  ComplianceRow,
  DeviceRow,
  DlpRow,
  IncidentRow,
  MalwareRow,
  PolicyRow,
  VulnRow,
} from './types'

export type DrawerView =
  | { kind: 'vulns'; title: string; rows: VulnRow[] }
  | { kind: 'vuln'; row: VulnRow }
  | { kind: 'incidents'; title: string; rows: IncidentRow[] }
  | { kind: 'incident'; row: IncidentRow }
  | { kind: 'malware'; title: string; rows: MalwareRow[] }
  | { kind: 'malware-detection'; row: MalwareRow }
  | { kind: 'dlp'; title: string; rows: DlpRow[] }
  | { kind: 'dlp-finding'; row: DlpRow }
  | { kind: 'devices'; title: string; rows: DeviceRow[] }
  | { kind: 'compliance'; title: string; rows: ComplianceRow[] }
  | { kind: 'compliance-result'; row: ComplianceRow }
  | { kind: 'alerts'; title: string; rows: AlertRow[] }
  | { kind: 'alert'; row: AlertRow }
  | { kind: 'policies'; title: string; rows: PolicyRow[] }
  | { kind: 'policy'; row: PolicyRow }

export function drawerTitle(view: DrawerView): string {
  switch (view.kind) {
    case 'vulns':
    case 'incidents':
    case 'malware':
    case 'dlp':
    case 'devices':
    case 'compliance':
    case 'alerts':
    case 'policies':
      return view.title
    case 'vuln':
      return view.row.cve_id || view.row.title || 'Vulnerability'
    case 'incident':
      return view.row.title || 'Incident'
    case 'malware-detection':
      return view.row.name ? `${view.row.name} detection` : view.row.title || 'Malware detection'
    case 'dlp-finding':
      return view.row.title || 'DLP finding'
    case 'compliance-result':
      return view.row.benchmark || 'Compliance assessment'
    case 'alert':
      return view.row.title || 'Alert'
    case 'policy':
      return view.row.name || 'Policy'
  }
}

export type DrawerContentProps = {
  view: DrawerView
  /** Push a deeper view (record detail) onto the drawer stack. */
  onOpenView: (view: DrawerView) => void
  /** Pop the stack, or null when this is the only view. */
  onBack: (() => void) | null
  /** Device drill-down choke point — opens the shared
      EndpointDetailDrawer, never a generic device view. */
  onOpenDevice: (device: DeviceRow) => void
  onNavigate: (moduleId: string, subsectionId?: string) => void
  hostnameOf: (deviceId: string | null | undefined) => string
  deviceOf: (deviceId: string | null | undefined) => DeviceRow | undefined
  now: number
}

/** Live (real endpoint) vs Sample (demo record) pill. */
export function OriginBadge({ sample }: { sample: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        sample
          ? { color: NULL_COLORS.info, background: '#EAF1F7' }
          : { color: NULL_COLORS.tealDark, background: NULL_COLORS.tealSoft }
      }
      title={
        sample
          ? 'Sample data — demonstration record, not live telemetry'
          : 'Live — real endpoint or record, not demonstration data'
      }
    >
      {sample ? 'Sample' : 'Live'}
    </span>
  )
}

function detailsButton(onClick: () => void) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-null-line px-2 py-1 text-xs font-medium text-null-teal hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
    >
      Details
    </button>
  )
}

function FieldList({ fields }: { fields: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="space-y-2.5">
      {fields.map((f) => (
        <div key={f.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-null-line pb-2 last:border-0 dark:border-white/10">
          <dt className="text-xs font-medium uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">{f.label}</dt>
          <dd className="min-w-0 text-right text-sm font-medium text-null-ink dark:text-white">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ModuleLink({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 inline-flex items-center gap-1.5 rounded bg-null-teal px-3 py-2 text-xs font-medium text-white hover:bg-null-tealDark"
    >
      {label} →
    </button>
  )
}

function DeviceLink({
  deviceId,
  hostnameOf,
  deviceOf,
  onOpenDevice,
}: {
  deviceId: string | null | undefined
  hostnameOf: (id: string | null | undefined) => string
  deviceOf: (id: string | null | undefined) => DeviceRow | undefined
  onOpenDevice: (device: DeviceRow) => void
}) {
  const device = deviceOf(deviceId)
  const name = hostnameOf(deviceId)
  if (!deviceId || !device) return <span>{name || '—'}</span>
  return (
    <button
      type="button"
      onClick={() => onOpenDevice(device)}
      className="inline-flex items-center gap-2 text-null-teal hover:underline"
      title="Open endpoint detail"
    >
      {name}
      <OriginBadge sample={isSampleDevice(device)} />
    </button>
  )
}

function vulnColumns(
  openView: (v: DrawerView) => void,
  hostnameOf: DrawerContentProps['hostnameOf'],
  deviceOf: DrawerContentProps['deviceOf'],
  onOpenDevice: DrawerContentProps['onOpenDevice'],
): DataTableColumn<VulnRow>[] {
  return [
    { key: 'cve_id', label: 'CVE', sortable: true, render: (r) => r.cve_id || '—' },
    { key: 'title', label: 'Title', sortable: true, render: (r) => <span className="line-clamp-2">{r.title || '—'}</span> },
    {
      key: 'severity',
      label: 'Severity',
      sortable: true,
      render: (r) => <SeverityBadge value={severityOf(r)} size="sm" />,
    },
    { key: 'cvss_score', label: 'CVSS', sortable: true, render: (r) => cvssOf(r)?.toFixed(1) ?? '—' },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge value={r.status} size="sm" /> },
    {
      key: 'device_id',
      label: 'Endpoint',
      render: (r) => (
        <DeviceLink deviceId={r.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
      ),
    },
    {
      key: 'detected_at',
      label: 'Detected',
      sortable: true,
      render: (r) => {
        const t = timeOf(r)
        return t !== null ? fmtDay(t) : '—'
      },
    },
    { key: 'id', label: '', render: (r) => detailsButton(() => openView({ kind: 'vuln', row: r })) },
  ]
}

export function DrawerContent(props: DrawerContentProps) {
  const { view, onOpenView, onBack, onOpenDevice, onNavigate, hostnameOf, deviceOf, now } =
    props

  const back =
    onBack !== null ? (
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-null-teal hover:underline"
      >
        ← Back to list
      </button>
    ) : null

  switch (view.kind) {
    case 'vulns':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'record' : 'records'} · severity from the stored value, or
            derived from CVSS when no severity is recorded.
          </p>
          <DataTable columns={vulnColumns(onOpenView, hostnameOf, deviceOf, onOpenDevice)} rows={view.rows} search pageSize={8} />
        </div>
      )
    case 'vuln': {
      const v = view.row
      const t = timeOf(v)
      const owner =
        v.attributes && typeof v.attributes.owner === 'string' ? (v.attributes.owner as string) : null
      const guidance =
        v.attributes && typeof v.attributes.remediation === 'string'
          ? (v.attributes.remediation as string)
          : null
      const linkedDevice = deviceOf(v.device_id)
      return (
        <div>
          {back}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SeverityBadge value={severityOf(v)} />
            <StatusBadge value={v.status} />
            <OriginBadge sample={v.is_demo === true} />
          </div>
          <FieldList
            fields={[
              { label: 'CVE', value: v.cve_id || '—' },
              { label: 'Title', value: v.title || '—' },
              { label: 'CVSS score', value: cvssOf(v)?.toFixed(1) ?? '—' },
              { label: 'Status', value: v.status || '—' },
              {
                label: 'Endpoint',
                value: (
                  <DeviceLink deviceId={v.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              { label: 'Detected', value: t !== null ? `${fmtDate(t)} (${fmtAge(t, now)})` : '—' },
              { label: 'Owner', value: owner ?? 'Not recorded' },
            ]}
          />
          {guidance ? (
            <div className="mt-4 rounded-lg bg-null-cloud p-3 text-sm leading-relaxed dark:bg-null-navy2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
                Remediation guidance
              </p>
              {guidance}
            </div>
          ) : (
            <p className="mt-4 text-xs text-null-muted dark:text-[#8AA0B8]">
              No remediation guidance recorded on this vulnerability.
            </p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
            This record carries no due date — deadlines are not a field on vulnerability records, so overdue
            work cannot be computed from it.
          </p>
          <ModuleLink label="Open in Vulnerabilities" onClick={() => onNavigate('vulnerabilities', 'vulns')} />
          {linkedDevice && (
            <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
              Endpoint OS / department are recorded only on sample endpoints; live endpoints carry neither.
            </p>
          )}
        </div>
      )
    }
    case 'incidents':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'record' : 'records'} · incidents carry no severity of
            their own; severity comes from their related alerts.
          </p>
          <DataTable
            columns={[
              { key: 'title', label: 'Title', sortable: true, render: (r) => <span className="line-clamp-2">{r.title || '—'}</span> },
              { key: 'action', label: 'Action', sortable: true, render: (r) => r.action || '—' },
              { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge value={r.status} size="sm" /> },
              {
                key: 'device_id',
                label: 'Endpoint',
                render: (r) => (
                  <DeviceLink deviceId={r.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              {
                key: 'created_at',
                label: 'Created',
                sortable: true,
                render: (r) => {
                  const t = timeOf(r)
                  return t !== null ? fmtDay(t) : '—'
                },
              },
              { key: 'id', label: '', render: (r) => detailsButton(() => onOpenView({ kind: 'incident', row: r })) },
            ]}
            rows={view.rows}
            search
            pageSize={8}
          />
        </div>
      )
    case 'incident': {
      const i = view.row
      const t = timeOf(i)
      return (
        <div>
          {back}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge value={i.status} />
            <OriginBadge sample={i.is_demo === true} />
          </div>
          <FieldList
            fields={[
              { label: 'Title', value: i.title || '—' },
              { label: 'Containment action', value: i.action || '—' },
              { label: 'Status', value: i.status || '—' },
              { label: 'Performed by', value: i.performed_by || '—' },
              {
                label: 'Endpoint',
                value: (
                  <DeviceLink deviceId={i.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              { label: 'Created', value: t !== null ? `${fmtDate(t)} (${fmtAge(t, now)})` : '—' },
            ]}
          />
          <p className="mt-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
            Incidents carry no severity and no resolution timestamp, so neither a severity nor a time-to-resolve
            can be shown for this record.
          </p>
          <ModuleLink label="Open in EDR" onClick={() => onNavigate('edr', 'incidents')} />
        </div>
      )
    }
    case 'malware':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'record' : 'records'} · quarantined means the
            quarantined flag is set or the status is quarantined / remediated.
          </p>
          <DataTable
            columns={[
              { key: 'name', label: 'Family', sortable: true, render: (r) => r.name || r.title || '—' },
              {
                key: 'severity',
                label: 'Severity',
                sortable: true,
                render: (r) => <SeverityBadge value={severityOf(r)} size="sm" />,
              },
              { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge value={r.status} size="sm" /> },
              { key: 'detection_layer', label: 'Layer', sortable: true, render: (r) => r.detection_layer || '—' },
              { key: 'mitre_ttp', label: 'MITRE TTP', sortable: true, render: (r) => r.mitre_ttp || '—' },
              {
                key: 'device_id',
                label: 'Endpoint',
                render: (r) => (
                  <DeviceLink deviceId={r.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              {
                key: 'created_at',
                label: 'Detected',
                sortable: true,
                render: (r) => {
                  const t = timeOf(r)
                  return t !== null ? fmtDay(t) : '—'
                },
              },
              { key: 'id', label: '', render: (r) => detailsButton(() => onOpenView({ kind: 'malware-detection', row: r })) },
            ]}
            rows={view.rows}
            search
            pageSize={8}
          />
        </div>
      )
    case 'malware-detection': {
      const m = view.row
      const t = timeOf(m)
      return (
        <div>
          {back}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SeverityBadge value={severityOf(m)} />
            <StatusBadge value={m.status} />
            <OriginBadge sample={m.is_demo === true} />
          </div>
          <FieldList
            fields={[
              { label: 'Family', value: m.name || '—' },
              { label: 'Title', value: m.title || '—' },
              { label: 'Status', value: m.status || '—' },
              { label: 'Quarantined', value: m.quarantined === true ? 'Yes' : m.quarantined === false ? 'No' : '—' },
              { label: 'Detection layer', value: m.detection_layer || '—' },
              { label: 'MITRE TTP', value: m.mitre_ttp || '—' },
              {
                label: 'Endpoint',
                value: (
                  <DeviceLink deviceId={m.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              { label: 'Detected', value: t !== null ? `${fmtDate(t)} (${fmtAge(t, now)})` : '—' },
            ]}
          />
          <ModuleLink label="Open in Malware" onClick={() => onNavigate('malware')} />
        </div>
      )
    }
    case 'dlp':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'record' : 'records'} · closed means remediated or
            encrypted.
          </p>
          <DataTable
            columns={[
              { key: 'title', label: 'Finding', sortable: true, render: (r) => <span className="line-clamp-2">{r.title || '—'}</span> },
              { key: 'data_type', label: 'Data type', sortable: true, render: (r) => r.data_type || '—' },
              { key: 'classification', label: 'Classification', sortable: true, render: (r) => r.classification || '—' },
              { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge value={r.status} size="sm" /> },
              { key: 'location', label: 'Location', render: (r) => <span className="break-all">{r.location || '—'}</span> },
              {
                key: 'device_id',
                label: 'Endpoint',
                render: (r) => (
                  <DeviceLink deviceId={r.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              { key: 'id', label: '', render: (r) => detailsButton(() => onOpenView({ kind: 'dlp-finding', row: r })) },
            ]}
            rows={view.rows}
            search
            pageSize={8}
          />
        </div>
      )
    case 'dlp-finding': {
      const d = view.row
      const t = timeOf(d)
      return (
        <div>
          {back}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge value={d.status} />
            <OriginBadge sample={d.is_demo === true} />
          </div>
          <FieldList
            fields={[
              { label: 'Finding', value: d.title || '—' },
              { label: 'Data type', value: d.data_type || '—' },
              { label: 'Classification', value: d.classification || '—' },
              { label: 'Status', value: d.status || '—' },
              { label: 'Location', value: d.location || '—' },
              {
                label: 'Endpoint',
                value: (
                  <DeviceLink deviceId={d.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              { label: 'Found', value: t !== null ? `${fmtDate(t)} (${fmtAge(t, now)})` : '—' },
            ]}
          />
          <ModuleLink label="Open in DLP" onClick={() => onNavigate('dlp', 'findings')} />
        </div>
      )
    }
    case 'devices':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'endpoint' : 'endpoints'} · Live endpoints are real
            enrolled devices; Sample endpoints are demonstration records.
          </p>
          <DataTable
            columns={[
              { key: 'hostname', label: 'Hostname', sortable: true, render: (r) => r.hostname || r.device_id || '—' },
              { key: 'device_id', label: 'Device ID', render: (r) => <span className="break-all text-xs">{r.device_id || '—'}</span> },
              {
                key: 'enrollment_status',
                label: 'Enrollment',
                sortable: true,
                render: (r) => <StatusBadge value={r.enrollment_status} size="sm" />,
              },
              { key: 'os', label: 'OS', render: (r) => osLabelOf(r) ?? '—' },
              {
                key: 'last_checkin_at',
                label: 'Last check-in',
                sortable: true,
                render: (r) => fmtAge(parseDate(r.last_checkin_at), now),
              },
              { key: 'origin', label: 'Origin', render: (r) => <OriginBadge sample={isSampleDevice(r)} /> },
              { key: 'id', label: '', render: (r) => detailsButton(() => onOpenDevice(r)) },
            ]}
            rows={view.rows}
            search
            pageSize={8}
          />
        </div>
      )
    case 'compliance':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'assessment' : 'assessments'} · non-compliant
            assessments are the platform&apos;s only record of policy violations — there is no violation record
            type.
          </p>
          <DataTable
            columns={[
              { key: 'benchmark', label: 'Benchmark', sortable: true, render: (r) => r.benchmark || '—' },
              { key: 'score', label: 'Score', sortable: true, render: (r) => r.score ?? '—' },
              { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge value={r.status} size="sm" /> },
              {
                key: 'device_id',
                label: 'Endpoint',
                render: (r) => (
                  <DeviceLink deviceId={r.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              {
                key: 'assessed_at',
                label: 'Assessed',
                sortable: true,
                render: (r) => {
                  const t = timeOf(r)
                  return t !== null ? fmtDay(t) : '—'
                },
              },
              { key: 'id', label: '', render: (r) => detailsButton(() => onOpenView({ kind: 'compliance-result', row: r })) },
            ]}
            rows={view.rows}
            search
            pageSize={8}
          />
        </div>
      )
    case 'compliance-result': {
      const c = view.row
      const t = timeOf(c)
      return (
        <div>
          {back}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge value={c.status} />
          </div>
          <FieldList
            fields={[
              { label: 'Benchmark', value: c.benchmark || '—' },
              { label: 'Score', value: c.score ?? '—' },
              { label: 'Status', value: c.status || '—' },
              {
                label: 'Endpoint',
                value: (
                  <DeviceLink deviceId={c.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              { label: 'Assessed', value: t !== null ? `${fmtDate(t)} (${fmtAge(t, now)})` : '—' },
            ]}
          />
          <ModuleLink label="Open in Compliance" onClick={() => onNavigate('compliance')} />
        </div>
      )
    }
    case 'alerts':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'alert' : 'alerts'} · alerts carry no is_demo flag, so
            no origin is shown for them.
          </p>
          <DataTable
            columns={[
              { key: 'title', label: 'Alert', sortable: true, render: (r) => <span className="line-clamp-2">{r.title || '—'}</span> },
              {
                key: 'severity',
                label: 'Severity',
                sortable: true,
                render: (r) => <SeverityBadge value={severityOf(r)} size="sm" />,
              },
              { key: 'category', label: 'Category', sortable: true, render: (r) => r.category || '—' },
              { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge value={r.status} size="sm" /> },
              {
                key: 'device_id',
                label: 'Endpoint',
                render: (r) => (
                  <DeviceLink deviceId={r.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              {
                key: 'created_at',
                label: 'Created',
                sortable: true,
                render: (r) => {
                  const t = timeOf(r)
                  return t !== null ? fmtDay(t) : '—'
                },
              },
              { key: 'id', label: '', render: (r) => detailsButton(() => onOpenView({ kind: 'alert', row: r })) },
            ]}
            rows={view.rows}
            search
            pageSize={8}
          />
        </div>
      )
    case 'alert': {
      const a = view.row
      const t = timeOf(a)
      return (
        <div>
          {back}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SeverityBadge value={severityOf(a)} />
            <StatusBadge value={a.status} />
          </div>
          <FieldList
            fields={[
              { label: 'Alert', value: a.title || '—' },
              { label: 'Category', value: a.category || '—' },
              { label: 'Status', value: a.status || '—' },
              {
                label: 'Endpoint',
                value: (
                  <DeviceLink deviceId={a.device_id} hostnameOf={hostnameOf} deviceOf={deviceOf} onOpenDevice={onOpenDevice} />
                ),
              },
              { label: 'Created', value: t !== null ? `${fmtDate(t)} (${fmtAge(t, now)})` : '—' },
            ]}
          />
          <ModuleLink label="Open in Alerts" onClick={() => onNavigate('alerts')} />
        </div>
      )
    }
    case 'policies':
      return (
        <div>
          <p className="mb-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            {view.rows.length} {view.rows.length === 1 ? 'policy' : 'policies'} · these are policy definitions,
            not violations — the platform has no violation record type.
          </p>
          <DataTable
            columns={[
              { key: 'name', label: 'Policy', sortable: true, render: (r) => <span className="line-clamp-2">{r.name || '—'}</span> },
              { key: 'policy_type', label: 'Type', sortable: true, render: (r) => r.policy_type || '—' },
              { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge value={r.status} size="sm" /> },
              {
                key: 'created_at',
                label: 'Created',
                sortable: true,
                render: (r) => {
                  const t = timeOf(r)
                  return t !== null ? fmtDay(t) : '—'
                },
              },
              { key: 'id', label: '', render: (r) => detailsButton(() => onOpenView({ kind: 'policy', row: r })) },
            ]}
            rows={view.rows}
            search
            pageSize={8}
          />
        </div>
      )
    case 'policy': {
      const p = view.row
      const t = timeOf(p)
      // Definition fields that are real policy content. Anything
      // starting with "sample_" is seed-only synthetic data and is
      // never displayed.
      const defEntries = Object.entries(p.definition ?? {}).filter(
        ([k, v]) => !k.startsWith('sample_') && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
      )
      return (
        <div>
          {back}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge value={p.status} />
            <OriginBadge sample={p.is_demo === true} />
          </div>
          <FieldList
            fields={[
              { label: 'Policy', value: p.name || '—' },
              { label: 'Type', value: p.policy_type || '—' },
              { label: 'Status', value: p.status || '—' },
              { label: 'Created', value: t !== null ? fmtDate(t) : '—' },
              ...defEntries.map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) })),
            ]}
          />
          <p className="mt-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
            Violation counts are not tracked for this policy — the platform records policy definitions, not
            violations. Non-compliant compliance assessments are the only violation proxy, and none are recorded
            for this policy.
          </p>
          <ModuleLink label="Open in Policies" onClick={() => onNavigate('policies')} />
        </div>
      )
    }
  }
}
