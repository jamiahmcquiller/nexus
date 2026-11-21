// NULL — Security Operations home: vulnerability prioritization.
//
// The ranked fix list for open vulnerabilities. The rule is
// stated on screen and uses only fields the records actually
// carry:
//   1. Severity first: critical → high → medium → low, then
//      unrecorded severity last.
//   2. Then CVSS score, highest first (no recorded score sorts
//      last).
//   3. Then oldest detection first (detected_at).
// There is NO deadline field on any vulnerability record, so due
// dates are not part of the ranking — age is shown instead, and
// the screen says so. Clicking a row opens the record detail;
// clicking an endpoint opens the endpoint drill-down.

import { SeverityBadge } from '../../components'
import { OriginBadge } from './DrawerViews'
import type { DrawerView } from './DrawerViews'
import { ageDays, cvssOf, fmtAge, isSampleDevice, severityOf, severityRank, timeOf } from './types'
import type { DeviceRow, VulnRow } from './types'

export type PrioritizedVulnsProps = {
  openVulns: VulnRow[]
  hostnameOf: (deviceId: string | null | undefined) => string
  deviceOf: (deviceId: string | null | undefined) => DeviceRow | undefined
  onOpenView: (view: DrawerView) => void
  onOpenDevice: (device: DeviceRow) => void
  now: number
}

const PAGE = 8

export function PrioritizedVulns(p: PrioritizedVulnsProps) {
  const ranked = [...p.openVulns].sort((a, b) => {
    const sev = severityRank(severityOf(a)) - severityRank(severityOf(b))
    if (sev !== 0) return sev
    const ca = cvssOf(a)
    const cb = cvssOf(b)
    if (ca !== null && cb !== null && ca !== cb) return cb - ca
    if (ca !== null && cb === null) return -1
    if (ca === null && cb !== null) return 1
    const ta = timeOf(a) ?? Number.POSITIVE_INFINITY
    const tb = timeOf(b) ?? Number.POSITIVE_INFINITY
    return ta - tb
  })
  const shown = ranked.slice(0, PAGE)

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
        Ranked by severity, then CVSS score, then oldest detection first. Age is days since detected_at.
        Vulnerability records carry no due date, so overdue work cannot be ranked — age is the only time
        signal.
      </p>
      {ranked.length === 0 ? (
        <p className="text-sm text-null-muted dark:text-[#8AA0B8]">
          No open vulnerabilities to prioritize.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-null-line text-left text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">
                  <th className="py-2 pr-2 font-semibold">#</th>
                  <th className="py-2 pr-2 font-semibold">CVE</th>
                  <th className="py-2 pr-2 font-semibold">Title</th>
                  <th className="py-2 pr-2 font-semibold">Severity</th>
                  <th className="py-2 pr-2 font-semibold">CVSS</th>
                  <th className="py-2 pr-2 font-semibold">Age</th>
                  <th className="py-2 pr-2 font-semibold">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v, idx) => {
                  const device = p.deviceOf(v.device_id)
                  const t = timeOf(v)
                  return (
                    <tr
                      key={v.id}
                      className="null-table-row border-b border-null-line align-top last:border-0 dark:border-white/10"
                    >
                      <td className="py-2 pr-2 font-semibold text-null-ink dark:text-white">{idx + 1}</td>
                      <td className="py-2 pr-2">
                        <button
                          type="button"
                          onClick={() => p.onOpenView({ kind: 'vuln', row: v })}
                          className="font-medium text-null-teal hover:underline"
                          title="Open vulnerability detail"
                        >
                          {v.cve_id || '—'}
                        </button>
                      </td>
                      <td className="max-w-56 py-2 pr-2">
                        <button
                          type="button"
                          onClick={() => p.onOpenView({ kind: 'vuln', row: v })}
                          className="block truncate text-left text-null-ink hover:text-null-teal dark:text-white"
                          title={v.title || 'Vulnerability detail'}
                        >
                          {v.title || '—'}
                        </button>
                      </td>
                      <td className="py-2 pr-2">
                        <SeverityBadge value={severityOf(v)} size="sm" />
                      </td>
                      <td className="py-2 pr-2 font-medium text-null-ink dark:text-white">
                        {cvssOf(v)?.toFixed(1) ?? '—'}
                      </td>
                      <td className="py-2 pr-2 text-null-muted dark:text-[#8AA0B8]">
                        {t !== null ? `${ageDays(t, p.now)}d` : '—'}
                      </td>
                      <td className="py-2 pr-2">
                        {device ? (
                          <button
                            type="button"
                            onClick={() => p.onOpenDevice(device)}
                            className="inline-flex items-center gap-1.5 text-null-teal hover:underline"
                            title="Open endpoint detail"
                          >
                            <span className="max-w-32 truncate">{p.hostnameOf(v.device_id)}</span>
                            <OriginBadge sample={isSampleDevice(device)} />
                          </button>
                        ) : (
                          <span className="text-null-muted dark:text-[#8AA0B8]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-null-muted dark:text-[#8AA0B8]">
              Showing {shown.length} of {ranked.length} open {ranked.length === 1 ? 'vulnerability' : 'vulnerabilities'}.
            </p>
            {ranked.length > PAGE && (
              <button
                type="button"
                onClick={() => p.onOpenView({ kind: 'vulns', title: 'Open vulnerabilities — prioritized', rows: ranked })}
                className="text-xs font-medium text-null-teal hover:underline"
              >
                View all {ranked.length} →
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
            Oldest open detection: {fmtAge(Math.min(...ranked.map((v) => timeOf(v) ?? p.now)), p.now)}.
          </p>
        </>
      )}
    </div>
  )
}
