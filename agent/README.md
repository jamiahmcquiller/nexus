# NEXUS Agent v0.3.3

Go-based endpoint agent for Windows, macOS, and Linux. One binary, no
installer, no dependencies.

## What it does

- **Enrollment** — registers the machine with the NEXUS backend using a
  one-time enrollment token (`nexus-<tenant_uuid>-<random>`). Enrollment
  spends the token and the backend returns this device's own credential
  (`device_token`), saved to `agent-config.json` next to the binary
  (0600). Every call after enrollment authenticates with that credential
  in the `X-Device-Token` header; the one-time token can never
  authenticate heartbeat, inventory, or command calls. The credential is
  never printed in logs.
- **Inventory** — collects hardware, OS, and installed-software data and
  uploads it to `POST /api/v1/devices/{device_id}/inventory`, where the
  console can read it back at `GET /api/v1/devices/{device_id}/inventory/latest`.
  Collected: hostname, OS name/version/build, CPU model and count, total
  memory, disks (size/free/filesystem), network interfaces (name, MAC,
  IPs), current user, and the installed-software list (Windows: the
  Uninstall registry keys; macOS: every `.app` bundle's Info.plist —
  real name, version, bundle identifier and vendor — across
  `/Applications`, `/System/Applications` and `~/Applications`, plus
  Homebrew; Linux: dpkg or rpm). On macOS each physical disk is
  reported once (`diskutil list -plist`; APFS volumes are listed under
  their disk, disk images and the snapshot container are excluded).
  It never uploads file contents, browsing history, keystrokes, or
  personal files.

## What's new in v0.3.3

- **Device record stays fresh** — the agent now sends its version with
  every inventory upload and heartbeat, and the backend stamps the
  device row from it (agent version, OS, software/disk counts), so the
  Endpoints table shows the latest inventory instead of the
  enrollment-time values.
- **macOS disk de-dup fixed** — the v0.3.2 parser read container
  volumes from the wrong plist key (`Partitions` instead of
  `APFSVolumes`), never saw the `APFSPhysicalStores` link, and
  required a `WholeDisk` key the schema doesn't carry — so it
  returned zero disks on the real Mac and the `df` fallback
  manufactured four bogus entries. All three are fixed, containers
  attach via their physical store, and the `df` fallback now logs a
  warning when it triggers. One debug log line per raw diskutil
  entry is emitted before de-dup.

## What's new in v0.3.2

- **macOS version detection fixed** — v0.3.1 parsed `sw_vers` by
  replacing `": "` with `=`, but `sw_vers` separates with colon + TAB,
  so the snapshot read `macOS <nil>`. Now parsed properly, with
  `SystemVersion.plist` as fallback; `os.name`/`os.version`/`os.build`
  populate (e.g. `macOS` / `26.1` / `25B78`).
- **Real app metadata on macOS** — each `.app` bundle's Info.plist is
  read for its real name, `CFBundleShortVersionString` and bundle
  identifier; the vendor is derived from the bundle identifier (small
  well-known map only where genuinely correct) or the code-signing
  authority, and is `Unknown` — never guessed, never `Apple` — when
  neither says. No more blank versions or `Apple` for Discord/Steam.
- **Physical disks on macOS** — one SSD is one disk. APFS volumes on
  the same disk are volumes of that disk, not separate disks, and
  virtual filesystems (devfs, map, disk images, the snapshot
  container) are excluded. `df` remains only as a fallback,
  de-duplicated by physical disk.
- **Discovery scope** — `/Applications`, `/System/Applications`
  (Safari, Mail and the other bundled apps v0.3.1 never scanned),
  `~/Applications`, plus one level of subdirectories (e.g.
  `/Applications/Utilities`); bundles are de-duplicated by bundle
  identifier and unreadable bundles are kept with best-effort metadata
  and a recorded error, never silently dropped.
- **Codespace port-privacy detection** — when the backend is behind a
  Codespace whose ports flipped back to Private, GitHub's sign-in wall
  answers API calls with a 401 and/or the sign-in HTML page. The agent
  now says so plainly (`the Codespace port is probably Private; set
  ports 8000 and 5173 to Public`) instead of logging a bare 401 that
  looks like a bad credential. A genuine JSON 401 still surfaces as a
  plain 401. The enrollment / device-auth protocol is unchanged.
- **Heartbeat** — reports check-in on a schedule so the console can
  show online/offline status. Default every 5 minutes (`-interval`);
  the macOS LaunchAgent install below uses 30 minutes.
- **Remote execution** — polls the backend every 30 seconds for commands
  queued by a signed-in owner/admin in the console and runs them as the
  agent's own user, then reports the exit code and output. Shells:
  PowerShell or `cmd` on Windows, `/bin/sh` elsewhere. Each run is
  time-boxed to 5 minutes, has no interactive input, and output is
  capped at 100 KB. Disable it entirely with `-no-remote-exec`.
- **Wake-on-LAN** — when the console queues a wake for an offline device,
  any online agent in the same organization claims the job and sends the
  magic packet on its own LAN (global broadcast plus each local subnet
  broadcast). The target's MAC comes from its last inventory snapshot.

## What it does not do

- No interactive remote desktop / screen sharing. Live sessions are
  recorded in the console (`RemoteSession`) but the screen-sharing relay
  is a later phase — this agent will not pretend to do it.
- No remote command runs without an owner/admin creating it in the
  console first, and every command is audit-logged (who created it, what
  ran, exit code, output) on the backend.

## Security model

- The backend only queues commands; it never executes anything.
- Command creation requires a signed-in owner/admin JWT. The agent
  authenticates with its per-device credential (`X-Device-Token`),
  issued once at enrollment and stored in `agent-config.json` (0600).
  The one-time enrollment token is spent at enrollment and cannot
  authenticate anything afterwards. A command is only visible to its
  own tenant — a credential from another organization sees nothing.
- Commands addressed to a specific device are only claimable by that
  device; tenant-wide commands (Wake-on-LAN) are claimable by any online
  agent in the tenant, first claim wins, and stale claims (agent died
  mid-run) return to pending after 10 minutes.
- The agent runs as its own user. Run it as administrator on Windows if
  you need elevated commands.

## Build

```sh
cd agent
go build -o nexus-agent .                              # this platform
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o nexus-agent-windows-amd64.exe .
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -o nexus-agent-darwin-arm64 .
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o nexus-agent-darwin-amd64 .
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o nexus-agent-linux-amd64 .
```

Prebuilt v0.3.2 binaries live in `~/workspace/nexus-agent-builds/`
(`nexus-agent-darwin-arm64`, `nexus-agent-darwin-amd64`,
`nexus-agent-linux-amd64`, `nexus-agent-windows-amd64.exe`). The
darwin-arm64 binary is the one for Apple Silicon Macs.

## macOS persistent install (LaunchAgent)

A manual run (`./nexus-agent …`) exits when the terminal closes. For a
machine that must stay visible in the console, install the agent as a
per-user LaunchAgent: it starts at login, restarts if it crashes, and
checks in every 30 minutes. The installer is
`agent/scripts/install-macos.sh`; the plist it installs is rendered from
`agent/scripts/com.null.agent.plist.template`.

### Enrollment-preservation guarantee

The installer **never re-enrolls and never needs an enrollment token**.
It requires an already-enrolled binary: it refuses to proceed unless
`agent-config.json` next to the binary contains a `device_id` **and** a
`device_token`. It then copies the binary and its config **together**
into `~/Library/Application Support/NULL/agent/` (binary 0755, config
0600, directory 0700) and leaves the originals in place as a backup
until the new location is verified working. No duplicate device is
created. If the config has no `device_token`, enroll the binary first
with one manual `-token` run, then re-run the installer.

### Install

```sh
# On the Mac, from the repo checkout:
cd agent/scripts
./install-macos.sh --binary ~/Downloads/nexus-agent-v032
# --server defaults to the server already in agent-config.json; pass
# --server https://<codespace>-8000.app.github.dev to point elsewhere.
```

What the installer does: verifies the enrollment, copies binary +
config, renders `~/Library/LaunchAgents/com.null.agent.plist`
(RunAtLoad + KeepAlive, loop mode — no `-once` — with
`-interval 30m -inventory-interval 1h -command-poll 30s`), loads it
with `launchctl bootstrap` (idempotent — re-running the installer stops
and reloads the job), then waits up to 90s for the first `heartbeat ok`
in the log. It exits non-zero if the job is not loaded, and warns
(rather than failing) if no heartbeat lands because the backend is
unreachable — the agent keeps retrying on its own schedule.

### Check status

```sh
./install-macos.sh --status          # job state + recent log lines
launchctl print gui/$UID/com.null.agent
tail -f ~/Library/Application\ Support/NULL/agent/agent.log
# "heartbeat ok" appears on every check-in (immediately at start, then
# every 30 minutes). Confirm in the NEXUS console that the device's
# last_checkin_at is fresh. Backend health: curl <server>/health
```

### Standing hazard — port visibility resets on rebuild

After ANY backend rebuild (`docker compose up --build` in the
Codespace), re-check that ports **8000** and **5173** are **Public**.
A rebuild can flip them back to Private, and then every agent
request hits GitHub's port-forward sign-in wall instead of the
backend: POSTs come back 401 and the command poll comes back as
the GitHub sign-in HTML page — while the device row, the token
hash, and the agent's saved credential are all intact. That is
what froze the Mac's check-ins in Nov 2026. Verify after every
rebuild: the Codespace Ports tab shows 8000/5173 Public, and a
`curl` of the `-8000` `/health` URL from outside the Codespace
returns 200. (Agent v0.3.2 also logs an actionable message when
it is redirected to a sign-in page or receives HTML where JSON
was expected, instead of a bare 401.)

### Stop / uninstall

```sh
launchctl bootout gui/$UID/com.null.agent   # stop now; restarts at login
./install-macos.sh --uninstall              # stop + remove the plist (keeps binary/config/logs)
./install-macos.sh --uninstall --remove-data
        # also deletes ~/Library/Application Support/NULL/agent — the
        # enrollment goes with agent-config.json, so only use this if
        # you intend to re-enroll with a fresh token.
```

### Follow-on (not yet built)

Windows (Task Scheduler / service) and Linux (systemd user unit)
persistent installs are the same pattern — install the enrolled binary
+ config together, run loop mode with the same intervals — but no
scripts ship for them yet. The manual loop-mode run below is the
stopgap on those platforms.

## Run (testing)

```powershell
# Windows PowerShell — first run enrolls the machine:
.\nexus-agent-windows-amd64.exe -server https://<codespace>-8000.app.github.dev -token nexus-<tenant>-<random> -once

# Then leave it running for heartbeats + remote commands:
.\nexus-agent-windows-amd64.exe -server https://<codespace>-8000.app.github.dev -token nexus-<tenant>-<random>
```

The backend must be reachable from the machine. In a Codespace the
backend port (8000) has to be forwarded and visible — the `-8000`
forwarded URL works while the Codespace is running.

```sh
# See exactly what the agent would collect, without sending anything:
./nexus-agent -dry-run
```

## Wake-on-LAN requirements

The sleeping machine must be wired (Ethernet — Wi-Fi wake is unreliable),
have Wake-on-LAN enabled in BIOS/UEFI and on the network adapter, and
have run the agent at least once while awake so its MAC address is in
its inventory. An online agent must be on the same LAN to send the
magic packet; the backend itself cannot reach the LAN.
