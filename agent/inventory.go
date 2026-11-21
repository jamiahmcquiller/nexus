package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"
)

type Software struct {
	Name      string `json:"name"`
	Publisher string `json:"publisher,omitempty"`
	Version   string `json:"version,omitempty"`
}

type Inventory struct {
	Hostname     string
	Manufacturer string
	Model        string
	Serial       string
	AssignedUser string
	OSName       string
	OSVersion    string
	OSBuild      string
	CPU          string
	RAMGB        int
	DiskTotalGB  int
	DiskFreeGB   int
	IP           string
	MAC          string
	// Security posture. nil means "could not tell".
	DiskEncryption *bool
	Firewall       *bool
	Antivirus      *bool
	AntivirusName  string
	EncryptionName string
	Software       []Software
}

// Attributes shapes the inventory the way the NEXUS console expects device attributes.
func (inv *Inventory) Attributes() map[string]any {
	sec := map[string]any{}
	if inv.DiskEncryption != nil {
		sec["bitlocker"] = *inv.DiskEncryption // console key for disk encryption on any OS
	}
	if inv.Firewall != nil {
		sec["firewall"] = *inv.Firewall
	}
	if inv.Antivirus != nil {
		sec["defender"] = *inv.Antivirus // console key for antivirus on any OS
	}
	if inv.AntivirusName != "" {
		sec["antivirus_name"] = inv.AntivirusName
	}
	if inv.EncryptionName != "" {
		sec["encryption_name"] = inv.EncryptionName
	}
	sort.Slice(inv.Software, func(i, j int) bool {
		return strings.ToLower(inv.Software[i].Name) < strings.ToLower(inv.Software[j].Name)
	})
	return map[string]any{
		"manufacturer":  inv.Manufacturer,
		"model":         inv.Model,
		"serial_number": inv.Serial,
		"assigned_user": inv.AssignedUser,
		"platform":      runtime.GOOS,
		"os":            map[string]any{"name": inv.OSName, "version": inv.OSVersion, "build": inv.OSBuild},
		"hardware": map[string]any{"cpu": inv.CPU, "ram_gb": inv.RAMGB, "disk_total_gb": inv.DiskTotalGB,
			"disk_free_gb": inv.DiskFreeGB, "architecture": runtime.GOARCH},
		"network":  map[string]any{"ip_address": inv.IP, "mac_address": inv.MAC},
		"security": sec,
		"software": inv.Software,
	}
}

// Collect gathers everything it can. Each probe is best-effort: a failure leaves that field empty.
func Collect() *Inventory {
	inv := &Inventory{}
	inv.Hostname, _ = os.Hostname()
	inv.Hostname = strings.TrimSuffix(inv.Hostname, ".local")
	inv.IP, inv.MAC = primaryNetwork()
	collectPlatform(inv)
	if inv.AssignedUser == "" {
		inv.AssignedUser = os.Getenv("USER")
		if inv.AssignedUser == "" {
			inv.AssignedUser = os.Getenv("USERNAME")
		}
	}
	return inv
}

// StableDeviceID derives an ID from the hardware/OS identifier so re-enrolling keeps the same device.
func StableDeviceID() (string, error) {
	raw, err := platformID()
	if err != nil || strings.TrimSpace(raw) == "" {
		h, _ := os.Hostname()
		raw = "host:" + h
	}
	sum := sha256.Sum256([]byte("nexus:" + strings.TrimSpace(raw)))
	return runtime.GOOS + "-" + hex.EncodeToString(sum[:])[:32], nil
}

func primaryNetwork() (string, string) {
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 || len(ifc.HardwareAddr) == 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLinkLocalUnicast() {
				return ipn.IP.String(), strings.ToUpper(ifc.HardwareAddr.String())
			}
		}
	}
	return "", ""
}

// run executes a command with a timeout and returns trimmed stdout ("" on any error).
func run(timeout time.Duration, name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil && len(out) == 0 {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func boolPtr(b bool) *bool { return &b }

func bytesToGB(b uint64) int { return int((b + (1 << 29)) >> 30) }
