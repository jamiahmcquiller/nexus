#!/usr/bin/env bash
# Build the NEXUS agent for every supported platform into agent/dist/.
# The backend serves these files at /api/v1/agent/download/<platform>.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
build() { CGO_ENABLED=0 GOOS=$1 GOARCH=$2 go build -trimpath -ldflags "-s -w" -o "dist/$3" . && echo "built dist/$3"; }
build darwin arm64  nexus-agent-macos-arm64
build darwin amd64  nexus-agent-macos-x86_64
build windows amd64 nexus-agent-windows-amd64.exe
build linux amd64   nexus-agent-linux-x86_64
