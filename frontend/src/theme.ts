// NEXUS Service — centralized brand tokens.
// Single source of truth for the brand color system. Every screen
// reads these values (via Tailwind `nexus-*` colors or the CSS
// variables in index.css) — no hardcoded blue/gray theme colors
// anywhere else in the console.
//
// NOTE on Cloud Gray: the brief lists it twice, as #F1F5F9 in the
// headline palette and #F5F7FA in the §1 implementation table.
// This file uses #F5F7FA (the §1 table value) for the main app
// background; #F1F5F9 is kept as `cloudDeep` for hover wells.

export const NEXUS_COLORS = {
  navy: '#142B4A', // Midnight Navy — sidebar, navigation, branding
  navyLight: '#1D3A5F', // hovered / selected nav item
  navyMuted: '#8AA0B8', // muted blue-gray nav labels on navy
  navyDeep: '#0E1F36', // darkest navy (login backdrop, dark-mode sidebar)
  teal: '#167C80', // Nexus Teal — primary buttons, active states, links
  tealDark: '#0F5E62', // teal hover / pressed
  tealSoft: '#E6F2F3', // teal tint for active pills and selected rows
  cloud: '#F5F7FA', // Cloud Gray — main application background
  cloudDeep: '#F1F5F9', // deeper cloud gray for hover wells
  white: '#FFFFFF', // cards, tables, modals, content surfaces
  slate: '#667085', // secondary text, descriptions, icons
  slateDark: '#344054', // body text
  border: '#E5EAF0', // dividers, borders, table outlines
  // Semantic status colors — meaning is fixed, never decorative.
  success: '#218568',
  warning: '#D99536',
  critical: '#C64D4D',
  info: '#3D6C9A',
  pending: '#7959C7',
} as const

export type StatusTone = 'success' | 'warning' | 'critical' | 'info' | 'pending' | 'neutral'

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
  // in progress / waiting
  testing: 'pending',
  scheduled: 'pending',
  pending: 'pending',
  investigating: 'pending',
  mitigated: 'pending',
  draft: 'pending',
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
  success: NEXUS_COLORS.success,
  warning: NEXUS_COLORS.warning,
  critical: NEXUS_COLORS.critical,
  info: NEXUS_COLORS.info,
  pending: NEXUS_COLORS.pending,
  neutral: NEXUS_COLORS.slate,
}

const TONE_SOFT_BG: Record<StatusTone, string> = {
  success: '#E7F3EE',
  warning: '#FBF3E4',
  critical: '#FBECEC',
  info: '#EAF1F7',
  pending: '#F0EBFB',
  neutral: '#EEF1F5',
}

/** Badge classes for a status/severity value, using the semantic palette. */
export function statusBadgeClasses(value: string | undefined | null): { color: string; background: string } {
  const tone = statusTone(value)
  return { color: TONE_HEX[tone], background: TONE_SOFT_BG[tone] }
}

export type ThemeMode = 'light' | 'dark'
export type Density = 'compact' | 'comfortable' | 'spacious'

export const THEME_STORAGE_KEY = 'nexus_theme'
export const DENSITY_STORAGE_KEY = 'nexus_density'
export const WORKSPACE_STORAGE_KEY = 'nexus_workspace'
