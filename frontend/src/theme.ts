// NULL — centralized brand tokens.
// Single source of truth for the brand color system. Every screen
// reads these values (via Tailwind `null-*` colors or the CSS
// variables in index.css) — no hardcoded blue/gray theme colors
// anywhere else in the console.
//
// The palette is site-literal from the NULL enterprise website
// (repo jamiahmcquiller/Null): Obsidian / navy2 / Teal / ink /
// muted / line / cloud. Light theme is the default; dark theme is
// deliberately designed in index.css (Obsidian app background,
// navy2 / Deep Slate surfaces), not an inversion.

export const NULL_COLORS = {
  // Canonical NULL palette (site-literal).
  obsidian: '#071525', // Obsidian — dark app background, sidebar, login backdrop
  navy2: '#102b45', // navy2 — elevated dark surfaces
  deepSlate: '#172A43', // Deep Slate — higher-elevation dark surfaces
  teal: '#17C3B2', // NULL Teal — identifying accent, used sparingly
  tealSecondary: '#20B7AA', // Teal Secondary
  ink: '#14243a', // primary text on light surfaces
  muted: '#65748a', // secondary text on light surfaces
  line: '#e1e7ee', // borders / dividers on light surfaces
  cloud: '#f4f7fa', // Cloud Gray — light app background
  white: '#FFFFFF', // cards, tables, modals, content surfaces
  // Compatibility keys — same values, old NEXUS names, so existing
  // screens (e.g. GrcWorkspace) keep working during the migration.
  // New code should use the canonical keys above.
  navy: '#14243a', // = ink
  navyLight: '#102b45', // = navy2 (hovered / selected nav item on dark)
  navyMuted: '#8AA0B8', // muted blue-gray labels on dark surfaces
  navyDeep: '#071525', // = obsidian
  slate: '#65748a', // = muted
  slateDark: '#14243a', // = ink
  border: '#e1e7ee', // = line
  tealDark: '#0FA79B', // teal hover / pressed
  tealSoft: '#E6F7F5', // teal tint for active pills and selected rows
  cloudDeep: '#EDF1F5', // deeper cloud gray for hover wells
  // Semantic status colors — meaning is fixed, never decorative.
  // The purple "pending" tone is gone: waiting / in-progress states
  // now read as info blue (#3D6C9A on #EAF1F7).
  success: '#218568',
  warning: '#D99536',
  critical: '#C64D4D',
  info: '#3D6C9A',
} as const

/**
 * @deprecated Use NULL_COLORS. Kept as an alias so screens that
 * still import NEXUS_COLORS keep working mid-transition; the shell
 * migration removes it once App.tsx and GrcWorkspace move over.
 */
export const NEXUS_COLORS = NULL_COLORS

export type StatusTone = 'success' | 'warning' | 'critical' | 'info' | 'neutral'

const STATUS_TONE_BY_VALUE: Record<string, StatusTone> = {
  // severity / priority
  critical: 'critical',
  p1: 'critical',
  high: 'warning',
  p2: 'warning',
  medium: 'info',
  p3: 'info',
  low: 'neutral',
  p4: 'neutral',
  // lifecycle — good / done
  deployed: 'success',
  remediated: 'success',
  resolved: 'success',
  recovered: 'success',
  complete: 'success',
  compliant: 'success',
  approved: 'success',
  contained: 'success',
  quarantined: 'success',
  active: 'success',
  available: 'success',
  running: 'success',
  // attention needed
  open: 'critical',
  new: 'critical',
  breached: 'critical',
  failed: 'critical',
  expired: 'critical',
  non_compliant: 'critical',
  // in progress / waiting — read as info blue, not purple
  testing: 'info',
  scheduled: 'info',
  pending: 'info',
  investigating: 'info',
  mitigated: 'info',
  draft: 'info',
  disabled: 'neutral',
  declined: 'neutral',
  ended: 'neutral',
  locked: 'warning',
  wiped: 'warning',
}

export function statusTone(value: string | undefined | null): StatusTone {
  if (!value) return 'neutral'
  return STATUS_TONE_BY_VALUE[value.toLowerCase()] ?? 'neutral'
}

const TONE_HEX: Record<StatusTone, string> = {
  success: NULL_COLORS.success,
  warning: NULL_COLORS.warning,
  critical: NULL_COLORS.critical,
  info: NULL_COLORS.info,
  neutral: NULL_COLORS.muted,
}

const TONE_SOFT_BG: Record<StatusTone, string> = {
  success: '#E7F3EE',
  warning: '#FBF3E4',
  critical: '#FBECEC',
  info: '#EAF1F7',
  neutral: '#EEF1F5',
}

/** Badge colors for a status/severity value, using the semantic palette. */
export function statusBadgeClasses(value: string | undefined | null): { color: string; background: string } {
  const tone = statusTone(value)
  return { color: TONE_HEX[tone], background: TONE_SOFT_BG[tone] }
}

export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'null_theme'
export const WORKSPACE_STORAGE_KEY = 'null_workspace'
export const TOKEN_STORAGE_KEY = 'null_token'
