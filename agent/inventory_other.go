//go:build !darwin && !windows

package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Linux support is basic: enough to test the agent end to end on a server or container.
func platformID() (string, error) {
	b, err := os.ReadFile("/etc/machine-id")
	return strings.TrimSpace(string(b)), err
}

func collectPlatform(inv *Inventory) {
	if f, err := os.Open("/etc/os-release"); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			k, v, ok := strings.Cut(sc.Text(), "=")
			v = strings.Trim(v, `"`)
			if ok && k == "PRETTY_NAME" {
				inv.OSName = v
			} else if ok && k == "VERSION_ID" {
				inv.OSVersion = v
			}
		}
		f.Close()
	}
	inv.OSBuild = run(5*time.Second, "uname", "-r")
	inv.Manufacturer = strings.TrimSpace(readFile("/sys/class/dmi/id/sys_vendor"))
	inv.Model = strings.TrimSpace(readFile("/sys/class/dmi/id/product_name"))
	if b := readFile("/proc/cpuinfo"); b != "" {
		for _, line := range strings.Split(b, "\n") {
			if strings.HasPrefix(line, "model name") {
				inv.CPU = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
				break
			}
		}
	}
	if b := readFile("/proc/meminfo"); b != "" {
		f := strings.Fields(strings.SplitN(b, "\n", 2)[0])
		if len(f) >= 2 {
			kb, _ := strconv.ParseUint(f[1], 10, 64)
			inv.RAMGB = bytesToGB(kb * 1024)
		}
	}
	var st syscall.Statfs_t
	if syscall.Statfs("/", &st) == nil {
		inv.DiskTotalGB = bytesToGB(st.Blocks * uint64(st.Bsize))
		inv.DiskFreeGB = bytesToGB(st.Bavail * uint64(st.Bsize))
	}
}

func readFile(p string) string { b, _ := os.ReadFile(p); return string(b) }
