# NEXUS Workspaces & Brand Theme (v0.4.0)

## Two administrator workspaces, one sign-in

The console is split into two administrator workspaces. Each has its
own navigation and its own home dashboard, and an authorized user
switches between them from the sidebar without signing in again —
the JWT from the single login authorizes both.

| Workspace | Home dashboard shows | Sections |
| --- | --- | --- |
| **IT Operations** — run the fleet | Endpoints, patches available, deployments scheduled, servers; patches needing attention | Endpoints, Patch Management, Asset Management, Application Distribution, Digital Employee Experience, Remote Access, OS Imaging, Configuration Management, MDM, Disk Encryption, Server Management, Scheduler |
| **Security Operations** — reduce risk | Open vulnerabilities, active incidents, malware detections, DLP findings; vulnerabilities needing attention | Vulnerabilities, EDR, Malware Protection, Anti-Ransomware, Browser Security, Application Control, Data Security / DLP, Secure Private Access, Compliance & Reporting, Policies |

The old single "Dashboard" module is gone — each workspace's home
replaces it. Module routes, data models, and workflows are
unchanged; only which navigation a workspace shows changed.

### Authorization (server-side)

`GET /api/v1/auth/workspaces` returns the workspaces the signed-in
user may open, derived from their role. The console renders only
what this endpoint returns; a workspace the role does not authorize
is shown disabled with the reason.

| Role | Workspaces |
| --- | --- |
| owner, admin | IT Operations + Security Operations |
| technician | IT Operations only |
| auditor | Security Operations only |
| anything else | none — the console says so plainly |

`GET /api/v1/auth/me` also includes `workspaces`. Switching
workspaces never clears the token and never re-authenticates; the
choice is remembered in `localStorage` (`nexus_workspace`) for the
next visit. If a stored workspace is not authorized for the user,
the console falls back to their first authorized workspace.

Tests: `nexus-backend/tests/test_workspaces.py` (7 tests, including
HTTP checks against the real router on in-memory SQLite).

## Brand color system

Centralized tokens — one source of truth, no hardcoded theme colors
in screens:

- `frontend/src/theme.ts` — palette, semantic status colors, and
  the status-to-tone mapping used by every badge.
- `frontend/tailwind.config.js` — `nexus-*` colors
  (`navy`, `teal`, `cloud`, `slate`, `border`, `success`,
  `warning`, `critical`, `info`, `pending`) and Inter/Manrope fonts.
- `frontend/src/index.css` — CSS variables for light and dark
  modes, shared
  card/input/table surfaces, and visible keyboard focus.

### Palette

| Color | Hex | Usage |
| --- | --- | --- |
| Midnight Navy | `#142B4A` | Sidebar, navigation, branding |
| Nexus Teal | `#167C80` | Primary buttons, active states, links, highlights |
| Cloud Gray | `#F5F7FA` | Main application background |
| White | `#FFFFFF` | Cards, tables, modals, content surfaces |
| Slate Gray | `#667085` | Secondary text, descriptions, icons |
| Border Gray | `#E5EAF0` | Dividers, borders, table outlines |

Note: the brief lists Cloud Gray twice — `#F1F5F9` in the headline
palette and `#F5F7FA` in the §1 table. The implementation uses
`#F5F7FA` (the §1 table value); `#F1F5F9` is kept as a deeper hover
well (`cloudDeep`).

### Status colors (meaning is fixed, never decorative)

| Meaning | Hex |
| --- | --- |
| Success | `#218568` |
| Warning | `#D99536` |
| Critical / Error | `#C64D4D` |
| Informational | `#3D6C9A` |
| Pending | `#7959C7` |

Applied to severity badges, status dots, incident priorities,
ticket statuses, SLA warnings, change risk, approvals, security
alerts, and notifications — see `statusTone()` in `theme.ts`.

### Personalization

- **Light / dark mode** — toggle in the top bar, remembered in
  `localStorage` (`nexus_theme`). Dark mode uses adjusted navy /
  charcoal surfaces with the same teal accents and the same status
  colors, so status meaning never changes with theme.
- **Typography** — Manrope for headings, Inter for body text.

### What changed in the console

- Sidebar: Midnight Navy, white NEXUS branding, muted blue-gray
  labels, teal left indicator on the active item, lighter navy on
  hover/selected; workspace switcher at the top of the sidebar.
- Top navigation: white, subtle gray bottom border, search that
  filters the current workspace's sections, theme controls,
  signed-in user and role.
- Main workspace: Cloud Gray background, white cards, teal primary
  buttons, white secondary buttons with gray borders, critical-red
  destructive actions.
- Tables: white, light gray dividers, navy/dark slate text, teal
  links and selected rows, gray hover, semantic status badges.
- Login: navy backdrop, white card, teal Sign In, same backend
  status messaging as before.

### Verification (2026-11-21)

- Frontend: `npm run build` passes (`tsc -b && vite build`).
  Also added the missing `frontend/src/vite-env.d.ts` — the
  frontend had never been built before; `import.meta.env` had no
  types.
- Backend: `python -m pytest tests/` — 14 passed (7 scheduler,
  7 workspace). This also fixed a latent bug in
  `app/auth.py`: `get_current_user` passed the JWT `sub` string
  straight into a UUID column filter, which Postgres tolerated
  and SQLite rejects; it now parses the UUID first.
- Not yet verified live: no database was available in this
  environment, so the workspaces were not clicked through against
  a running backend. Run `./scripts/start-nexus.sh --docker`,
  sign in, and switch workspaces from the sidebar before demoing.
