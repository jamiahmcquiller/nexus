//go:build darwin

package main

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func platformID() (string, error) {
	out := run(10*time.Second, "ioreg", "-rd1", "-c", "IOPlatformExpertDevice")
	if m := regexp.MustCompile(`"IOPlatformUUID" = "([^"]+)"`).FindStringSubmatch(out); m != nil {
		return m[1], nil
	}
	return "", nil
}

func collectPlatform(inv *Inventory) {
	inv.Manufacturer = "Apple"
	inv.OSName = "macOS " + run(5*time.Second, "sw_vers", "-productVersion")
	inv.OSVersion = run(5*time.Second, "sw_vers", "-productVersion")
	inv.OSBuild = run(5*time.Second, "sw_vers", "-buildVersion")
	if name := macOSName(inv.OSVersion); name != "" {
		inv.OSName = "macOS " + name
	}

	var hw struct {
		Items []map[string]any `json:"SPHardwareDataType"`
	}
	if json.Unmarshal([]byte(run(30*time.Second, "system_profiler", "SPHardwareDataType", "-json")), &hw) == nil && len(hw.Items) > 0 {
		h := hw.Items[0]
		str := func(k string) string { s, _ := h[k].(string); return s }
		inv.Model = str("machine_name")
		if id := str("machine_model"); id != "" {
			inv.Model = strings.TrimSpace(inv.Model + " (" + id + ")")
		}
		inv.Serial = str("serial_number")
		inv.CPU = str("chip_type")
		if inv.CPU == "" {
			inv.CPU = strings.TrimSpace(str("cpu_type") + " " + str("current_processor_speed"))
		}
		if m := regexp.MustCompile(`(\d+)\s*GB`).FindStringSubmatch(str("physical_memory")); m != nil {
			inv.RAMGB, _ = strconv.Atoi(m[1])
		}
	}
	if inv.RAMGB == 0 {
		if n, err := strconv.ParseUint(run(5*time.Second, "sysctl", "-n", "hw.memsize"), 10, 64); err == nil {
			inv.RAMGB = bytesToGB(n)
		}
	}

	// The data volume holds user files on modern macOS
	for _, p := range []string{"/System/Volumes/Data", "/"} {
		var st syscall.Statfs_t
		if syscall.Statfs(p, &st) == nil {
			inv.DiskTotalGB = bytesToGB(uint64(st.Blocks) * uint64(st.Bsize))
			inv.DiskFreeGB = bytesToGB(uint64(st.Bavail) * uint64(st.Bsize))
			break
		}
	}

	inv.AssignedUser = run(5*time.Second, "stat", "-f", "%Su", "/dev/console")
	if inv.AssignedUser == "root" {
		inv.AssignedUser = ""
	}

	inv.EncryptionName = "FileVault"
	if fv := run(10*time.Second, "fdesetup", "status"); fv != "" {
		inv.DiskEncryption = boolPtr(strings.Contains(fv, "FileVault is On"))
	}
	if fw := run(10*time.Second, "/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate"); fw != "" {
		inv.Firewall = boolPtr(strings.Contains(strings.ToLower(fw), "enabled") || strings.Contains(fw, "State = 1"))
	}
	// XProtect is built into macOS and always on; report it when its bundle is present.
	inv.AntivirusName = "XProtect"
	if run(5*time.Second, "ls", "/Library/Apple/System/Library/CoreServices/XProtect.bundle") != "" ||
		run(5*time.Second, "ls", "/System/Library/CoreServices/XProtect.bundle") != "" {
		inv.Antivirus = boolPtr(true)
	}

	inv.Software = macApps()
}

func macApps() []Software {
	var data struct {
		Items []struct {
			Name         string `json:"_name"`
			Version      string `json:"version"`
			Path         string `json:"path"`
			ObtainedFrom string `json:"obtained_from"`
			Info         string `json:"info"`
		} `json:"SPApplicationsDataType"`
	}
	raw := run(90*time.Second, "system_profiler", "SPApplicationsDataType", "-json")
	if json.Unmarshal([]byte(raw), &data) != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []Software
	for _, a := range data.Items {
		// Skip macOS system components and helper apps buried inside other bundles
		if a.Name == "" || a.ObtainedFrom == "apple" || strings.HasPrefix(a.Path, "/System/") ||
			strings.HasPrefix(a.Path, "/Library/Apple/") || strings.Count(a.Path, ".app/") > 0 {
			continue
		}
		key := strings.ToLower(a.Name)
		if seen[key] {
			continue
		}
		seen[key] = true
		pub := ""
		switch a.ObtainedFrom {
		case "mac_app_store":
			pub = "Mac App Store"
		case "identified_developer":
			pub = "Identified developer"
		}
		out = append(out, Software{Name: a.Name, Version: a.Version, Publisher: pub})
	}
	return out
}

func macOSName(version string) string {
	names := map[string]string{"11": "Big Sur", "12": "Monterey", "13": "Ventura", "14": "Sonoma", "15": "Sequoia", "26": "Tahoe"}
	if n, ok := names[strings.SplitN(version, ".", 2)[0]]; ok {
		return n + " " + version
	}
	return ""
}
