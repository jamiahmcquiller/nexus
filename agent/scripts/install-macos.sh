#!/bin/bash
# NULL Endpoint Agent — macOS installer (v0.3.3)
#
# Installs an ALREADY-ENROLLED agent binary as a per-user LaunchAgent so
# it runs persistently (RunAtLoad + KeepAlive) and checks in every
# 30 minutes. It does NOT enroll a new device and does NOT need an
# enrollment token: the per-device credential lives in agent-config.json
# next to the binary, and this script installs the binary and its config
# TOGETHER into a stable home, preserving the existing enrollment.
#
#   ./install-macos.sh [--server URL] [--binary PATH]
#
# Defaults:
#   --server  taken from agent-config.json (the server the device already
#             talks to); pass --server to point it at a new backend URL.
#   --binary  ~/Downloads/nexus-agent-v033
#   install home: ~/Library/Application Support/NULL/agent
#
# The original binary + config are left untouched in place as a backup
# until the new location is verified working. Only delete them after the
# agent has checked in from the new location (see the success message).
#
# Other modes:
#   ./install-macos.sh --status      show job state + recent log lines
#   ./install-macos.sh --uninstall   stop the job and remove the plist
#   ./install-macos.sh --uninstall --remove-data
#                                    also delete the installed binary,
#                                    config and logs (the enrollment is
#                                    gone with the config — only do this
#                                    if you intend to re-enroll)
#
# Requirements: macOS, python3 (ships with macOS; used only to read the
# JSON config and to render the plist template — no network, no secrets
# are printed). This script never prints the device credential.
#
# Exit codes: 0 ok, 1 usage/config error, 2 install or verification
# failure (job not loaded).

set -euo pipefail

LABEL="com.null.agent"
DEFAULT_BINARY="$HOME/Downloads/nexus-agent-v033"
DEFAULT_HOME="$HOME/Library/Application Support/NULL/agent"
LAUNCHAGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCHAGENTS_DIR/$LABEL.plist"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/com.null.agent.plist.template"

SERVER=""
BINARY="$DEFAULT_BINARY"
INSTALL_HOME="$DEFAULT_HOME"
MODE="install"
REMOVE_DATA=0

usage() {
    sed -n '2,40p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

log()  { printf '%s\n' "[install-macos] $*"; }
die()  { printf '%s\n' "[install-macos] ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --server)        SERVER="${2:-}"; shift 2 ;;
        --server=*)      SERVER="${1#--server=}"; shift ;;
        --binary)        BINARY="${2:-}"; shift 2 ;;
        --binary=*)      BINARY="${1#--binary=}"; shift ;;
        --install-home)  INSTALL_HOME="${2:-}"; shift 2 ;;
        --install-home=*) INSTALL_HOME="${1#--install-home=}"; shift ;;
        --uninstall)     MODE="uninstall"; shift ;;
        --remove-data)   REMOVE_DATA=1; shift ;;
        --status)        MODE="status"; shift ;;
        -h|--help)       usage 0 ;;
        *) die "unknown argument: $1 (try --help)" ;;
    esac
done

# ---------------------------------------------------------------- helpers

# Read one string field out of a JSON config file. Prints nothing and
# exits non-zero when the file is not valid JSON or the field is absent.
config_field() {
    python3 - "$1" "$2" <<'EOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
except Exception as e:
    sys.exit(f"config is not valid JSON: {e}")
val = cfg.get(sys.argv[2]) or ""
print(val)
EOF
}

job_loaded() {
    launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1
}

do_status() {
    if job_loaded; then
        log "job $LABEL is LOADED"
        launchctl print "gui/$UID/$LABEL" 2>/dev/null \
            | grep -E '^\s+(state|program|last exit code|pid)' || true
    else
        log "job $LABEL is NOT loaded"
    fi
    local logfile="$INSTALL_HOME/agent.log"
    if [ -f "$logfile" ]; then
        log "last log lines ($logfile):"
        tail -n 10 "$logfile"
        if grep -q "heartbeat ok" "$logfile"; then
            log "last heartbeat: $(grep "heartbeat ok" "$logfile" | tail -n 1)"
        else
            log "no successful heartbeat in the log yet"
        fi
    else
        log "no log file yet at $logfile"
    fi
}

do_uninstall() {
    if job_loaded; then
        log "stopping $LABEL ..."
        launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || \
            launchctl unload "$PLIST_PATH" 2>/dev/null || true
    fi
    if [ -f "$PLIST_PATH" ]; then
        rm -f "$PLIST_PATH"
        log "removed $PLIST_PATH"
    else
        log "no plist at $PLIST_PATH (already gone)"
    fi
    if [ "$REMOVE_DATA" -eq 1 ]; then
        rm -rf "$INSTALL_HOME"
        log "removed $INSTALL_HOME (binary, config and logs deleted — the device enrollment is gone with agent-config.json; re-enrollment with a fresh token is required to run again)"
    else
        log "kept $INSTALL_HOME — re-run ./install-macos.sh to reinstall"
    fi
    log "uninstalled."
}

# ---------------------------------------------------------------- modes

if [ "$MODE" = "status" ]; then
    do_status
    exit 0
fi

if [ "$MODE" = "uninstall" ]; then
    do_uninstall
    exit 0
fi

# ---------------------------------------------------------------- install

[ -f "$TEMPLATE" ] || die "plist template not found: $TEMPLATE"

# Resolve the binary to an absolute path (macOS has no readlink -f).
case "$BINARY" in
    ~*) BINARY="$HOME/${BINARY#\~\/}" ;;
esac
[ -f "$BINARY" ] || die "binary not found: $BINARY
  Pass the path to the enrolled v0.3.3 binary, e.g.:
      ./install-macos.sh --binary ~/Downloads/nexus-agent-v033"
[ -x "$BINARY" ] || die "binary is not executable: $BINARY"

SRC_CONFIG="$(dirname "$BINARY")/agent-config.json"
[ -f "$SRC_CONFIG" ] || die "no agent-config.json next to the binary ($SRC_CONFIG).
  The agent's enrollment lives in that file. Install the binary together
  with the config it was enrolled with — do not point this script at a
  bare binary or it would enroll as a NEW device."

# --- Enrollment preservation gate --------------------------------------
# The config must already carry this device's own credential, issued at
# enrollment. Without it the agent would re-enroll with a one-time token
# and create a DUPLICATE device. Refuse instead of guessing.
DEVICE_ID="$(config_field "$SRC_CONFIG" device_id)" \
    || die "could not read $SRC_CONFIG"
DEVICE_TOKEN="$(config_field "$SRC_CONFIG" device_token)" \
    || die "could not read $SRC_CONFIG"
[ -n "$DEVICE_ID" ] || die "agent-config.json has no device_id — this device is not enrolled.
  Enroll the binary first (one run with -token), then re-run this installer."
[ -n "$DEVICE_TOKEN" ] || die "agent-config.json has no device_token — this device is not enrolled.
  The one-time enrollment token in the config is spent at enrollment and
  cannot authenticate the agent afterwards. Enroll the binary first
  (one run with -token), then re-run this installer."
log "enrollment found: device_id=$DEVICE_ID (device credential present, not shown)"

# Server: explicit flag wins, otherwise keep the server the device
# already uses. Never silently fall back to localhost.
if [ -z "$SERVER" ]; then
    SERVER="$(config_field "$SRC_CONFIG" server)"
fi
[ -n "$SERVER" ] || die "no server URL: pass --server https://<codespace>-8000.app.github.dev
  or make sure agent-config.json has a server value."
case "$SERVER" in
    http://*|https://*) ;;
    *) die "server URL must start with http:// or https:// (got: $SERVER)" ;;
esac
log "server: $SERVER"

# Backend reachable? Warn only — the job can still be installed and will
# start heartbeating as soon as the backend is up (e.g. a sleeping
# Codespace). Verification below distinguishes "job loaded" from
# "heartbeat seen".
if curl -fsS --max-time 10 "$SERVER/health" >/dev/null 2>&1; then
    log "backend reachable ($SERVER/health)"
else
    log "WARNING: backend not reachable at $SERVER/health right now.
  Continuing — the agent will retry on its own schedule — but no
  heartbeat will land until the backend (Codespace) is running."
fi

# --- Install binary + config together ----------------------------------
mkdir -p "$INSTALL_HOME"
chmod 700 "$INSTALL_HOME"
mkdir -p "$LAUNCHAGENTS_DIR"

DST_BINARY="$INSTALL_HOME/nexus-agent"
DST_CONFIG="$INSTALL_HOME/agent-config.json"
LOG_PATH="$INSTALL_HOME/agent.log"
ERR_LOG_PATH="$INSTALL_HOME/agent-error.log"

cp -f "$BINARY" "$DST_BINARY"
chmod 755 "$DST_BINARY"
cp -f "$SRC_CONFIG" "$DST_CONFIG"
chmod 600 "$DST_CONFIG"
log "installed binary -> $DST_BINARY"
log "installed config -> $DST_CONFIG (0600, enrollment preserved)"
log "originals left in place as backup: $BINARY and $SRC_CONFIG"

# Sanity: the installed config still carries the credential.
INSTALLED_TOKEN="$(config_field "$DST_CONFIG" device_token)"
[ -n "$INSTALLED_TOKEN" ] || die "installed config lost its device_token — refusing to continue"
[ "$(config_field "$DST_CONFIG" device_id)" = "$DEVICE_ID" ] \
    || die "installed config device_id does not match $DEVICE_ID — refusing to continue"

# --- Render + load the LaunchAgent --------------------------------------
python3 - "$TEMPLATE" "$PLIST_PATH" \
    "$DST_BINARY" "$DST_CONFIG" "$SERVER" "$LOG_PATH" "$ERR_LOG_PATH" <<'EOF'
import sys
template, dest, binary, config, server, log, errlog = sys.argv[1:8]
with open(template) as f:
    text = f.read()
for placeholder, value in {
    "__AGENT_BINARY__": binary,
    "__AGENT_CONFIG__": config,
    "__SERVER_URL__": server,
    "__LOG_PATH__": log,
    "__ERROR_LOG_PATH__": errlog,
}.items():
    assert placeholder in text, f"placeholder {placeholder} missing from template"
    text = text.replace(placeholder, value)
with open(dest, "w") as f:
    f.write(text)
EOF
chmod 644 "$PLIST_PATH"
log "wrote $PLIST_PATH"

# Idempotent load: stop any previous copy of the job first, then load.
if job_loaded; then
    log "job already loaded — stopping it before reload"
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || \
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
    sleep 1
fi
if ! launchctl bootstrap "gui/$UID" "$PLIST_PATH" 2>/dev/null; then
    # Older macOS / fallback path.
    launchctl load -w "$PLIST_PATH" || die "launchctl could not load $PLIST_PATH"
fi

# --- Verify --------------------------------------------------------------
if ! job_loaded; then
    die "launchctl does not show $LABEL as loaded after bootstrap.
  Check the plist with:  plutil -lint $PLIST_PATH"
fi
log "job $LABEL is LOADED (RunAtLoad + KeepAlive)"

# The agent heartbeats immediately on start, then every 30 minutes.
# Wait up to 90s for proof in the log.
log "waiting up to 90s for the first heartbeat in the log ..."
HEARTBEAT_SEEN=0
for _ in $(seq 1 18); do
    if [ -f "$LOG_PATH" ] && grep -q "heartbeat ok" "$LOG_PATH"; then
        HEARTBEAT_SEEN=1
        break
    fi
    sleep 5
done

echo
if [ "$HEARTBEAT_SEEN" -eq 1 ]; then
    log "SUCCESS — first heartbeat seen in the log:"
    grep "heartbeat ok" "$LOG_PATH" | tail -n 1
    echo
    log "The agent is now a persistent service: it starts at login,"
    log "restarts if it crashes, checks in every 30 minutes, uploads"
    log "inventory hourly, and polls for remote commands every 30s."
    echo
    log "Confirm in the NEXUS console that device $DEVICE_ID"
    log "shows a fresh last_checkin_at (it updates on every heartbeat)."
    echo
    log "Backup: the originals at $BINARY and $SRC_CONFIG are still"
    log "there. Once the console shows fresh check-ins, you can delete"
    log "them — the installed copies in $INSTALL_HOME are the live ones."
else
    log "WARNING — job is loaded but no heartbeat landed within 90s."
    log "The agent will keep retrying on its own. Most likely causes:"
    log "  1. the backend/Codespace is down — check $SERVER/health"
    log "  2. the server URL is wrong — compare with agent-config.json"
    log "Recent log output:"
    [ -f "$LOG_PATH" ] && tail -n 20 "$LOG_PATH" || log "(no log file yet)"
    [ -f "$ERR_LOG_PATH" ] && tail -n 20 "$ERR_LOG_PATH"
    echo
    log "Check status any time with:  ./install-macos.sh --status"
    exit 2
fi

echo
log "Status:   ./install-macos.sh --status"
log "Logs:     tail -f \"$LOG_PATH\""
log "Stop:     launchctl bootout gui/\$UID/$LABEL"
log "Uninstall: ./install-macos.sh --uninstall"
