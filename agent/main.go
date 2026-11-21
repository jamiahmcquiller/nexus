// NEXUS Endpoint Agent v0.3.1
//
// Endpoint agent: enrolls with the NEXUS backend using a one-time
// enrollment token, receives its own per-device credential, and then
// authenticates heartbeat, inventory and command polling with that
// credential (X-Device-Token). It collects hardware / OS / software
// inventory, sends a periodic heartbeat, executes remote commands
// queued by an owner/admin, and sends Wake-on-LAN magic packets on
// its own LAN when asked. It never uploads file contents, and never
// reads browsing history, keystrokes, or personal files. Remote
// execution is owner/admin-authorized, audit-logged, time-boxed to 5
// minutes, and can be disabled with -no-remote-exec.
//
// Usage (Windows PowerShell):
//
//	.\nexus-agent.exe -server https://<codespace>-8000.app.github.dev -token nexus-<tenant>-<random> -once
//
// Flags:
//	-server    backend base URL (default http://localhost:8000)
//	-token     enrollment token (nexus-<tenant_uuid>-<random>)
//	-config    config file holding server/token/device_id (default agent-config.json)
//	-interval  heartbeat interval (default 5m)
//	-inventory-interval  how often a full inventory is uploaded (default 1h)
//	-command-poll   how often to check for queued remote commands (default 30s)
//	-no-remote-exec refuse remote commands and Wake-on-LAN jobs
//	-once      enroll + inventory + heartbeat once, then exit
//	-dry-run   collect inventory and print it as JSON, send nothing
//	-version   print version and exit
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const version = "0.3.1"

const defaultServer = "http://localhost:8000"

// ---------------------------------------------------------------- config

type agentConfig struct {
	Server          string `json:"server"`
	Token           string `json:"token"`
	DeviceID        string `json:"device_id"`
	DeviceToken     string `json:"device_token,omitempty"` // issued at enrollment; sent as X-Device-Token. Never logged in full.
	AllowRemoteExec *bool  `json:"allow_remote_exec,omitempty"` // nil = allowed (default)
}

func (c agentConfig) remoteExecAllowed() bool {
	return c.AllowRemoteExec == nil || *c.AllowRemoteExec
}

func configPath(flagPath string) string {
	if flagPath != "" {
		return flagPath
	}
	exe, err := os.Executable()
	if err == nil {
		return filepath.Join(filepath.Dir(exe), "agent-config.json")
	}
	return "agent-config.json"
}

func loadConfig(path string) agentConfig {
	cfg := agentConfig{Server: defaultServer}
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	if cfg.Server == "" {
		cfg.Server = defaultServer
	}
	return cfg
}

func saveConfig(path string, cfg agentConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func redactToken(tok string) string {
	if len(tok) > 12 {
		return tok[:12] + "..."
	}
	return "present"
}

// ------------------------------------------------------------ inventory

// runCmd runs a command with a timeout and returns trimmed stdout.
// A failure returns "" and the error; collectors record the failure
// and carry on — one broken collector must never fail the whole run.
func runCmd(timeout time.Duration, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Start(); err != nil {
		return "", err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(errBuf.String()))
		}
		return strings.TrimSpace(out.String()), nil
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		return "", fmt.Errorf("timed out after %s", timeout)
	}
}

func parseKVList(text string) map[string]string {
	m := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, "=") {
			continue
		}
		kv := strings.SplitN(line, "=", 2)
		m[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
	}
	return m
}

func osInfo() map[string]any {
	info := map[string]any{"platform": runtime.GOOS, "arch": runtime.GOARCH}
	switch runtime.GOOS {
	case "windows":
		if out, err := runCmd(15*time.Second, "powershell", "-NoProfile", "-Command",
			"(Get-CimInstance Win32_OperatingSystem).Caption + '|' + (Get-CimInstance Win32_OperatingSystem).Version + '|' + (Get-CimInstance Win32_OperatingSystem).BuildNumber"); err == nil && out != "" {
			parts := strings.Split(out, "|")
			if len(parts) >= 3 {
				info["name"] = strings.TrimSpace(parts[0])
				info["version"] = strings.TrimSpace(parts[1])
				info["build"] = strings.TrimSpace(parts[2])
			}
		}
		if info["name"] == nil {
			if out, err := runCmd(10*time.Second, "cmd", "/c", "ver"); err == nil {
				info["name"] = out
			}
		}
	case "darwin":
		if out, err := runCmd(10*time.Second, "sw_vers"); err == nil {
			for k, v := range parseKVList(strings.ReplaceAll(out, ": ", "=")) {
				info[strings.ToLower(k)] = v
			}
			info["name"] = "macOS " + fmt.Sprint(info["productversion"])
			info["version"] = info["productversion"]
		}
	default: // linux and others
		if data, err := os.ReadFile("/etc/os-release"); err == nil {
			kv := parseKVList(string(data))
			info["name"] = strings.Trim(kv["PRETTY_NAME"], "\"")
			info["version"] = strings.Trim(kv["VERSION_ID"], "\"")
			info["id"] = kv["ID"]
		}
		if out, err := runCmd(10*time.Second, "uname", "-r"); err == nil {
			info["kernel"] = out
		}
	}
	return info
}

func cpuInfo() map[string]any {
	info := map[string]any{"count": runtime.NumCPU()}
	switch runtime.GOOS {
	case "windows":
		if out, err := runCmd(15*time.Second, "powershell", "-NoProfile", "-Command",
			"(Get-CimInstance Win32_Processor | Select-Object -First 1).Name"); err == nil && out != "" {
			info["model"] = out
		}
	case "darwin":
		if out, err := runCmd(10*time.Second, "sysctl", "-n", "machdep.cpu.brand_string"); err == nil {
			info["model"] = out
		}
	default:
		if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(line, "model name") {
					info["model"] = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
					break
				}
			}
		}
	}
	return info
}

func memoryInfo() map[string]any {
	info := map[string]any{}
	switch runtime.GOOS {
	case "windows":
		if out, err := runCmd(15*time.Second, "powershell", "-NoProfile", "-Command",
			"(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"); err == nil {
			if n, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64); err == nil {
				info["total_mb"] = n / 1024 / 1024
			}
		}
	case "darwin":
		if out, err := runCmd(10*time.Second, "sysctl", "-n", "hw.memsize"); err == nil {
			if n, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64); err == nil {
				info["total_mb"] = n / 1024 / 1024
			}
		}
	default:
		if data, err := os.ReadFile("/proc/meminfo"); err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if strings.HasPrefix(line, "MemTotal:") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						if n, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
							info["total_mb"] = n / 1024
						}
					}
				}
			}
		}
	}
	return info
}

func diskInfo() []map[string]any {
	var disks []map[string]any
	switch runtime.GOOS {
	case "windows":
		out, err := runCmd(15*time.Second, "powershell", "-NoProfile", "-Command",
			"Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | ForEach-Object { $_.DeviceID + '|' + $_.Size + '|' + $_.FreeSpace + '|' + $_.FileSystem }")
		if err != nil {
			return disks
		}
		for _, line := range strings.Split(out, "\n") {
			parts := strings.Split(strings.TrimSpace(line), "|")
			if len(parts) != 4 {
				continue
			}
			size, _ := strconv.ParseInt(parts[1], 10, 64)
			free, _ := strconv.ParseInt(parts[2], 10, 64)
			disks = append(disks, map[string]any{"device": parts[0], "total_gb": size / 1024 / 1024 / 1024, "free_gb": free / 1024 / 1024 / 1024, "filesystem": parts[3]})
		}
	default:
		out, err := runCmd(10*time.Second, "df", "-B1", "--output=source,size,avail,fstype", "-x", "tmpfs", "-x", "devtmpfs")
		if err != nil {
			// macOS df has no --output; fall back to plain df -k.
			out, err = runCmd(10*time.Second, "df", "-k")
			if err != nil {
				return disks
			}
			for _, line := range strings.Split(out, "\n")[1:] {
				f := strings.Fields(line)
				if len(f) < 6 {
					continue
				}
				size, _ := strconv.ParseInt(f[1], 10, 64)
				free, _ := strconv.ParseInt(f[3], 10, 64)
				disks = append(disks, map[string]any{"device": f[0], "total_gb": size * 1024 / 1024 / 1024 / 1024, "free_gb": free * 1024 / 1024 / 1024 / 1024, "filesystem": f[0]})
			}
			return disks
		}
		for _, line := range strings.Split(out, "\n")[1:] {
			f := strings.Fields(line)
			if len(f) != 4 {
				continue
			}
			size, _ := strconv.ParseInt(f[1], 10, 64)
			free, _ := strconv.ParseInt(f[2], 10, 64)
			disks = append(disks, map[string]any{"device": f[0], "total_gb": size / 1024 / 1024 / 1024, "free_gb": free / 1024 / 1024 / 1024, "filesystem": f[3]})
		}
	}
	return disks
}

func softwareList(errors *[]string) []map[string]any {
	var apps []map[string]any
	add := func(name, version, vendor string) {
		name = strings.TrimSpace(name)
		if name == "" || name == "Name" {
			return
		}
		apps = append(apps, map[string]any{"name": name, "version": strings.TrimSpace(version), "vendor": strings.TrimSpace(vendor)})
	}
	switch runtime.GOOS {
	case "windows":
		out, err := runCmd(60*time.Second, "powershell", "-NoProfile", "-Command",
			"Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName } | ForEach-Object { $_.DisplayName + '|' + $_.DisplayVersion + '|' + $_.Publisher }")
		if err != nil {
			*errors = append(*errors, "software (registry): "+err.Error())
			break
		}
		for _, line := range strings.Split(out, "\n") {
			parts := strings.Split(strings.TrimSpace(line), "|")
			if len(parts) < 1 {
				continue
			}
			ver, vendor := "", ""
			if len(parts) > 1 {
				ver = parts[1]
			}
			if len(parts) > 2 {
				vendor = parts[2]
			}
			add(parts[0], ver, vendor)
		}
	case "darwin":
		entries, err := os.ReadDir("/Applications")
		if err != nil {
			*errors = append(*errors, "software (/Applications): "+err.Error())
			break
		}
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".app") {
				add(strings.TrimSuffix(e.Name(), ".app"), "", "Apple")
			}
		}
		if out, err := runCmd(15*time.Second, "brew", "list", "--versions"); err == nil {
			for _, line := range strings.Split(out, "\n") {
				f := strings.Fields(line)
				if len(f) >= 2 {
					add(f[0], f[1], "Homebrew")
				}
			}
		}
	default:
		if out, err := runCmd(30*time.Second, "dpkg-query", "-W", "-f=${Package}|${Version}\n"); err == nil {
			for _, line := range strings.Split(out, "\n") {
				parts := strings.Split(strings.TrimSpace(line), "|")
				if len(parts) == 2 {
					add(parts[0], parts[1], "")
				}
			}
		} else if out, err := runCmd(30*time.Second, "rpm", "-qa", "--queryformat", "%{NAME}|%{VERSION}\n"); err == nil {
			for _, line := range strings.Split(out, "\n") {
				parts := strings.Split(strings.TrimSpace(line), "|")
				if len(parts) == 2 {
					add(parts[0], parts[1], "")
				}
			}
		} else {
			*errors = append(*errors, "software (no dpkg/rpm found)")
		}
	}
	sort.Slice(apps, func(i, j int) bool { return fmt.Sprint(apps[i]["name"]) < fmt.Sprint(apps[j]["name"]) })
	if len(apps) > 500 {
		apps = apps[:500]
	}
	return apps
}

func networkInfo() []map[string]any {
	var ifaces []map[string]any
	list, err := net.Interfaces()
	if err != nil {
		return ifaces
	}
	for _, iface := range list {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		var ips []string
		for _, a := range addrs {
			ips = append(ips, a.String())
		}
		ifaces = append(ifaces, map[string]any{"name": iface.Name, "mac": iface.HardwareAddr.String(), "ips": ips})
	}
	return ifaces
}

func stableDeviceID() string {
	hostname, _ := os.Hostname()
	// Windows: the machine GUID is the stable identifier.
	if runtime.GOOS == "windows" {
		if out, err := runCmd(10*time.Second, "reg", "query", `HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid"); err == nil {
			for _, line := range strings.Split(out, "\n") {
				if strings.Contains(line, "MachineGuid") {
					fields := strings.Fields(line)
					if len(fields) >= 3 {
						return "win-" + strings.ToLower(fields[len(fields)-1])
					}
				}
			}
		}
	}
	if runtime.GOOS == "linux" {
		if data, err := os.ReadFile("/etc/machine-id"); err == nil {
			if id := strings.TrimSpace(string(data)); id != "" {
				return "linux-" + id
			}
		}
	}
	// Fallback: hostname + first MAC, hashed so no raw MAC leaves the box.
	ifaces, _ := net.Interfaces()
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback == 0 && len(iface.HardwareAddr) > 0 {
			sum := sha256.Sum256([]byte(hostname + "|" + iface.HardwareAddr.String()))
			return runtime.GOOS + "-" + hex.EncodeToString(sum[:])[:16]
		}
	}
	return runtime.GOOS + "-" + hostname
}

type inventory struct {
	Hardware map[string]any   `json:"hardware"`
	OS       map[string]any   `json:"os"`
	Software []map[string]any `json:"software"`
	Errors   []string         `json:"collection_errors,omitempty"`
}

func collectInventory() inventory {
	var errs []string
	hostname, _ := os.Hostname()
	currentUser := ""
	if u, err := user.Current(); err == nil {
		currentUser = u.Username
	}
	hardware := map[string]any{
		"hostname": hostname,
		"cpu":      cpuInfo(),
		"memory":   memoryInfo(),
		"disks":    diskInfo(),
		"network":  networkInfo(),
	}
	inv := inventory{
		Hardware: hardware,
		OS:       osInfo(),
		Software: softwareList(&errs),
		Errors:   errs,
	}
	inv.Hardware["current_user"] = currentUser
	return inv
}

// -------------------------------------------------------------- backend

type client struct {
	server      string
	token       string // one-time enrollment token (enroll only)
	deviceToken string // per-device credential (everything after enroll)
	http        *http.Client
}

func (c *client) post(path string, payload any) (int, []byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(c.server, "/")+path, bytes.NewReader(data))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body, nil
}

// postDevice is post() authenticated as this device: heartbeat,
// inventory upload and command completion send the per-device
// credential in the X-Device-Token header. Enrollment uses post() —
// the enrollment token is spent there and can never authenticate
// these calls.
func (c *client) postDevice(path string, payload any) (int, []byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(c.server, "/")+path, bytes.NewReader(data))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Device-Token", c.deviceToken)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body, nil
}

func (c *client) enroll(hostname, deviceID string, inv inventory) (string, error) {
	payload := map[string]any{
		"enrollment_token": c.token,
		"hostname":         hostname,
		"device_id":        deviceID,
		"agent_version":    version,
		"attributes": map[string]any{
			"os":        inv.OS,
			"cpu":       inv.Hardware["cpu"],
			"memory":    inv.Hardware["memory"],
			"disks":     len(inv.Hardware["disks"].([]map[string]any)),
			"software":  len(inv.Software),
			"collected": time.Now().UTC().Format(time.RFC3339),
		},
	}
	status, body, err := c.post("/api/v1/devices/enroll", payload)
	if err != nil {
		return "", err
	}
	if status >= 400 {
		return "", fmt.Errorf("enroll failed (HTTP %d): %s", status, strings.TrimSpace(string(body)))
	}
	// Enrollment spends the one-time token and returns this device's
	// own credential. It is saved to the config file (0600) and used
	// for every call after this one.
	var resp struct {
		DeviceToken string `json:"device_token"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("enroll response unreadable: %v", err)
	}
	if resp.DeviceToken == "" {
		return "", fmt.Errorf("enroll succeeded but the backend issued no device credential")
	}
	return resp.DeviceToken, nil
}

func (c *client) uploadInventory(deviceID string, inv inventory) error {
	payload := map[string]any{
		"hardware":     inv.Hardware,
		"os":           inv.OS,
		"software":     inv.Software,
		"collected_at": time.Now().UTC().Format(time.RFC3339),
	}
	status, body, err := c.postDevice("/api/v1/devices/"+deviceID+"/inventory", payload)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("inventory upload failed (HTTP %d): %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *client) heartbeat() error {
	status, body, err := c.postDevice("/api/v1/devices/heartbeat", map[string]any{})
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("heartbeat failed (HTTP %d): %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

// nextCommand asks the backend for the oldest pending command for this
// device (or any tenant-wide command, e.g. Wake-on-LAN). It returns
// nil, nil when the queue is empty (HTTP 204).
func (c *client) nextCommand(deviceID string) (*agentCommand, error) {
	q := url.Values{}
	q.Set("device_id", deviceID)
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(c.server, "/")+"/api/v1/agent/commands/next?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Device-Token", c.deviceToken)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 204 {
		return nil, nil
	}
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("command poll failed (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var cmd agentCommand
	if err := json.Unmarshal(body, &cmd); err != nil {
		return nil, err
	}
	return &cmd, nil
}

func (c *client) completeCommand(commandID string, exitCode int, result string) error {
	status, body, err := c.postDevice("/api/v1/agent/commands/"+commandID+"/complete",
		map[string]any{"exit_code": exitCode, "result": result})
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("command complete failed (HTTP %d): %s", status, strings.TrimSpace(string(body)))
	}
	return nil
}

// -------------------------------------------------- remote execution

type agentCommand struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"` // shell, powershell, wol
	Command string `json:"command"`
	Status  string `json:"status"`
}

const (
	commandTimeout = 5 * time.Minute
	maxResultBytes = 100 * 1024
)

// sendMagicPacket broadcasts a Wake-on-LAN magic packet for mac to the
// global broadcast address and to every local subnet broadcast address.
func sendMagicPacket(mac string) error {
	hw, err := net.ParseMAC(mac)
	if err != nil {
		return fmt.Errorf("invalid MAC %q: %v", mac, err)
	}
	packet := make([]byte, 6+16*6)
	for i := 0; i < 6; i++ {
		packet[i] = 0xFF
	}
	for i := 0; i < 16; i++ {
		copy(packet[6+i*6:], hw)
	}
	targets := map[string]bool{"255.255.255.255:9": true}
	ifaces, _ := net.Interfaces()
	for _, iface := range ifaces {
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || ipnet.IP.To4() == nil {
				continue
			}
			broadcast := make(net.IP, 4)
			for i := 0; i < 4; i++ {
				broadcast[i] = ipnet.IP.To4()[i] | ^ipnet.Mask[i]
			}
			targets[broadcast.String()+":9"] = true
		}
	}
	var lastErr error
	sent := 0
	for target := range targets {
		udpAddr, err := net.ResolveUDPAddr("udp", target)
		if err != nil {
			lastErr = err
			continue
		}
		conn, err := net.DialUDP("udp", nil, udpAddr)
		if err != nil {
			lastErr = err
			continue
		}
		_, err = conn.Write(packet)
		conn.Close()
		if err != nil {
			lastErr = err
			continue
		}
		sent++
	}
	if sent == 0 {
		return fmt.Errorf("could not send magic packet: %v", lastErr)
	}
	return nil
}

// runShell executes one command with a timeout and returns its exit
// code and combined output (capped at 100 KB). No interactive input.
func runShell(kind, command string) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	var cmd *exec.Cmd
	switch {
	case kind == "powershell" && runtime.GOOS == "windows":
		cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", command)
	case kind == "powershell":
		// No PowerShell on this platform; say so instead of failing silently.
		return 1, "powershell is not available on " + runtime.GOOS + "; use kind 'shell'"
	case runtime.GOOS == "windows":
		cmd = exec.CommandContext(ctx, "cmd", "/c", command)
	default:
		cmd = exec.CommandContext(ctx, "/bin/sh", "-c", command)
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	result := out.String()
	if len(result) > maxResultBytes {
		result = result[:maxResultBytes] + "\n... [output truncated at 100 KB]"
	}
	if ctx.Err() == context.DeadlineExceeded {
		return 124, result + "\n[command timed out after 5 minutes]"
	}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode(), result
		}
		return 1, result + "\n[execution error: " + err.Error() + "]"
	}
	return 0, result
}

// processOneCommand polls for a single queued command and runs it.
// Returns true when a command was executed.
func processOneCommand(cli *client, deviceID string) bool {
	cmd, err := cli.nextCommand(deviceID)
	if err != nil {
		log.Printf("command poll failed: %v", err)
		return false
	}
	if cmd == nil {
		return false
	}
	log.Printf("running remote command %s (kind=%s)", cmd.ID, cmd.Kind)
	var exitCode int
	var result string
	switch cmd.Kind {
	case "wol":
		if err := sendMagicPacket(cmd.Command); err != nil {
			exitCode, result = 1, "wake-on-lan failed: "+err.Error()
		} else {
			exitCode, result = 0, "magic packet sent to "+cmd.Command
		}
	default:
		exitCode, result = runShell(cmd.Kind, cmd.Command)
	}
	if err := cli.completeCommand(cmd.ID, exitCode, result); err != nil {
		log.Printf("could not report result for command %s: %v", cmd.ID, err)
	} else {
		log.Printf("remote command %s finished (exit %d)", cmd.ID, exitCode)
	}
	return true
}

// ------------------------------------------------------------------ main

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	serverFlag := flag.String("server", "", "NEXUS backend base URL, e.g. https://<codespace>-8000.app.github.dev")
	tokenFlag := flag.String("token", "", "enrollment token (nexus-<tenant_uuid>-<random>)")
	configFlag := flag.String("config", "", "config file path (default agent-config.json next to the executable)")
	intervalFlag := flag.Duration("interval", 5*time.Minute, "heartbeat interval")
	inventoryFlag := flag.Duration("inventory-interval", time.Hour, "how often a full inventory is uploaded")
	commandPollFlag := flag.Duration("command-poll", 30*time.Second, "how often to check for queued remote commands")
	noRemoteExecFlag := flag.Bool("no-remote-exec", false, "refuse remote commands and Wake-on-LAN jobs")
	onceFlag := flag.Bool("once", false, "enroll, upload inventory and heartbeat once, then exit")
	dryRunFlag := flag.Bool("dry-run", false, "collect inventory, print it as JSON, send nothing")
	versionFlag := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("NEXUS Endpoint Agent v%s\n", version)
		return
	}

	if *dryRunFlag {
		inv := collectInventory()
		out, _ := json.MarshalIndent(inv, "", "  ")
		fmt.Println(string(out))
		return
	}

	cfgPath := configPath(*configFlag)
	cfg := loadConfig(cfgPath)
	if *serverFlag != "" {
		cfg.Server = *serverFlag
	}
	if *tokenFlag != "" {
		cfg.Token = *tokenFlag
	}
	if cfg.DeviceToken == "" && (cfg.Token == "" || !strings.HasPrefix(cfg.Token, "nexus-")) {
		log.Fatalf("an enrollment token is required: run with -token nexus-<tenant_uuid>-<random> (get one from the NEXUS console or generate_token.py)")
	}
	if cfg.DeviceID == "" {
		cfg.DeviceID = stableDeviceID()
	}
	if *noRemoteExecFlag {
		disabled := false
		cfg.AllowRemoteExec = &disabled
	}
	if err := saveConfig(cfgPath, cfg); err != nil {
		log.Printf("warning: could not save config to %s: %v", cfgPath, err)
	}

	hostname, _ := os.Hostname()
	cli := &client{server: cfg.Server, token: cfg.Token, deviceToken: cfg.DeviceToken, http: &http.Client{Timeout: 30 * time.Second}}
	log.Printf("NEXUS Endpoint Agent v%s — device %s, server %s (token %s), remote execution %v", version, cfg.DeviceID, cfg.Server, redactToken(cfg.Token), cfg.remoteExecAllowed())

	runCycle := func(uploadInv bool) {
		inv := collectInventory()
		if len(inv.Errors) > 0 {
			log.Printf("inventory collection warnings: %s", strings.Join(inv.Errors, "; "))
		}
		if cfg.DeviceToken == "" {
			// First run only: enroll with the one-time token. The
			// token is spent by this call; the backend returns this
			// device's own credential, which authenticates every
			// call after this one. Later runs skip enrollment and
			// use the stored credential.
			deviceToken, err := cli.enroll(hostname, cfg.DeviceID, inv)
			if err != nil {
				log.Printf("enroll failed: %v", err)
				return
			}
			cfg.DeviceToken = deviceToken
			cli.deviceToken = deviceToken
			if err := saveConfig(cfgPath, cfg); err != nil {
				log.Printf("warning: could not save device credential to %s: %v", cfgPath, err)
			}
			log.Printf("enrolled as %s (%d software items found)", hostname, len(inv.Software))
		}
		if uploadInv {
			if err := cli.uploadInventory(cfg.DeviceID, inv); err != nil {
				log.Printf("inventory upload failed: %v", err)
			} else {
				log.Printf("inventory uploaded (%d software items)", len(inv.Software))
			}
		}
		if err := cli.heartbeat(); err != nil {
			log.Printf("heartbeat failed: %v", err)
		} else {
			log.Printf("heartbeat ok")
		}
		if cfg.remoteExecAllowed() {
			processOneCommand(cli, cfg.DeviceID)
		}
	}

	runCycle(true)
	if *onceFlag {
		return
	}

	invTicker := time.NewTicker(*inventoryFlag)
	hbTicker := time.NewTicker(*intervalFlag)
	cmdTicker := time.NewTicker(*commandPollFlag)
	defer invTicker.Stop()
	defer hbTicker.Stop()
	defer cmdTicker.Stop()
	for {
		select {
		case <-invTicker.C:
			runCycle(true)
		case <-hbTicker.C:
			if err := cli.heartbeat(); err != nil {
				log.Printf("heartbeat failed: %v", err)
			} else {
				log.Printf("heartbeat ok")
			}
		case <-cmdTicker.C:
			if cfg.remoteExecAllowed() {
				processOneCommand(cli, cfg.DeviceID)
			}
		}
	}
}
