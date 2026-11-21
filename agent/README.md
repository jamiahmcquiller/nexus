# NEXUS Agent v0.3.0

Go-based endpoint agent for Windows, macOS, and Linux. One binary, no
installer, no dependencies.

## What it does

- **Enrollment** — registers the machine with the NEXUS backend using a
  one-time enrollment token (`nexus-<tenant_uuid>-<random>`). The token
  is saved to `agent-config.json` next to the binary so later runs reuse
  it. The token is never printed in logs.
- **Inventory** — collects hardware, OS, and installed-software data and
  uploads it to `POST /api/v1/devices/{device_id}/inventory`, where the
  console can read it back at `GET /api/v1/devices/{device_id}/inventory/latest`.
  Collected: hostname, OS name/version/build, CPU model and count, total
  memory, disks (size/free/filesystem), network interfaces (name, MAC,
  IPs), current user, and the installed-software list (Windows: the
  Uninstall registry keys; macOS: /Applications + Homebrew; Linux:
  dpkg or rpm). It never uploads file contents, browsing history,
  keystrokes, or personal files.
- **Heartbeat** — reports check-in every 5 minutes so the console can
  show online/offline status.
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
  authenticates with its enrollment token, and a command is only visible
  to its own tenant — a token from another organization sees nothing.
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
```

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
