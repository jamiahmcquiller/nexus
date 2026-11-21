# NEXUS Agent

Cross-platform endpoint agent (macOS, Windows; basic Linux) written in Go with no dependencies.

**What it does**
- Enrolls with a one-time-use-window enrollment code from the console, then authenticates every check-in with its own device key
- Reports hardware, OS, network, installed software, and security posture
  (FileVault / BitLocker, firewall, XProtect / Microsoft Defender)
- Checks in every 5 minutes; sends a full inventory every 6 hours
- Starts at login via a LaunchAgent (macOS) or a scheduled task (Windows)

Read-only: it never runs remote commands.

**Build**
```bash
./build.sh            # writes agent/dist/*, served by the backend at /api/v1/agent/download/<platform>
```

**Use**
```bash
nexus-agent enroll --server https://YOUR-NEXUS --token nexus-...
nexus-agent install    # keep it running in the background
nexus-agent inventory  # print what would be sent, without sending
nexus-agent status | once | run | uninstall
```
