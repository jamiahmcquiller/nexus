// Per-section presentation config for the module-page rollout.
// Keyed by API endpoint path (the stable key, e.g. '/api/v1/patches/').
// ModulePage.tsx consumes this; moduleConfig.*.ts files provide it.
// GRC has its own workspace and is NOT covered here.

export type ModuleColumnKind = 'name' | 'detail' | 'status' | 'severity' | 'date' | 'text'

export type ModuleColumn = {
  /** Record key the column reads (for 'date'/'text' kinds). For
      'name'/'detail'/'status'/'severity', use the kind itself as the key. */
  key: string
  label: string
  kind: ModuleColumnKind
}

export type ModulePresentation = {
  /** Columns for the DataTable, left to right. */
  columns: ModuleColumn[]
  /** Record keys shown (in order) in the generic record detail drawer. */
  detailFields: string[]
  /** Stats-endpoint key -> human label for the summary strip.
      Only list keys the section's /stats endpoint actually returns. */
  statLabels: Record<string, string>
  /** Honest empty state when the section has no records. */
  emptyTitle: string
  emptyDescription: string
}
