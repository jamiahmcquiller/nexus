// NEXUS endpoint agent: enrolls a computer with a NEXUS console, then reports
// inventory and checks in on a schedule. Read-only: it never runs remote commands.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

const Version = "0.2.0"

func usage() {
	fmt.Fprintf(os.Stderr, `NEXUS agent %s

Usage:
  nexus-agent enroll --server URL --token CODE   Connect this computer to NEXUS
  nexus-agent run                                Check in on a schedule (runs until stopped)
  nexus-agent once                               Send one full check-in and exit
  nexus-agent install                            Start automatically at login (macOS, Windows)
  nexus-agent uninstall                          Stop starting automatically
  nexus-agent status                             Show enrollment details
  nexus-agent inventory                          Print what would be reported (sends nothing)
  nexus-agent version

Options:
  --config PATH    Where enrollment details are saved (default: %s)
`, Version, defaultConfigPath())
}

func main() {
	log.SetFlags(log.LstdFlags)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd := os.Args[1]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	server := fs.String("server", "", "NEXUS server address, e.g. https://nexus.example.com")
	token := fs.String("token", "", "Enrollment code from the NEXUS console")
	cfgPath := fs.String("config", defaultConfigPath(), "Path to the agent config file")
	interval := fs.Duration("interval", 0, "Override the check-in interval (e.g. 1m)")
	_ = fs.Parse(os.Args[2:])

	switch cmd {
	case "version", "--version", "-v":
		fmt.Println(Version)
	case "inventory":
		inv := Collect()
		out, _ := json.MarshalIndent(inv, "", "  ")
		fmt.Println(string(out))
	case "enroll":
		if *server == "" || *token == "" {
			fmt.Fprintln(os.Stderr, "enroll needs --server and --token. Copy both from the Enroll a device page in NEXUS.")
			os.Exit(2)
		}
		must(cmdEnroll(strings.TrimRight(*server, "/"), strings.TrimSpace(*token), *cfgPath))
	case "once":
		cfg := mustLoad(*cfgPath)
		res, err := NewClient(cfg).Checkin(true)
		must(err)
		fmt.Printf("Checked in with %s. Next check-in in %ds.\n", cfg.Server, res.Interval)
	case "run":
		cfg := mustLoad(*cfgPath)
		runLoop(cfg, *interval)
	case "install":
		must(installService(*cfgPath))
	case "uninstall":
		must(uninstallService())
	case "status":
		cfg := mustLoad(*cfgPath)
		fmt.Printf("Server:     %s\nDevice ID:  %s\nEnrolled:   %s\nConfig:     %s\n", cfg.Server, cfg.DeviceID, cfg.EnrolledAt, *cfgPath)
	default:
		usage()
		os.Exit(2)
	}
}

func cmdEnroll(server, token, cfgPath string) error {
	fmt.Println("Collecting device details…")
	inv := Collect()
	deviceID, err := StableDeviceID()
	if err != nil {
		return fmt.Errorf("could not determine a device ID: %w", err)
	}
	c := &Client{Server: server, http: newHTTPClient()}
	res, err := c.Enroll(token, deviceID, inv)
	if err != nil {
		return err
	}
	cfg := &Config{Server: server, DeviceID: deviceID, AgentKey: res.AgentKey, EnrolledAt: time.Now().UTC().Format(time.RFC3339)}
	if err := cfg.Save(cfgPath); err != nil {
		return err
	}
	fmt.Printf("Enrolled %s with NEXUS. It will appear under Endpoints now.\n", inv.Hostname)
	fmt.Println("Next: run `nexus-agent install` so it keeps checking in in the background.")
	return nil
}

func runLoop(cfg *Config, override time.Duration) {
	client := NewClient(cfg)
	every := 5 * time.Minute
	if override > 0 {
		every = override
	}
	lastFull := time.Time{}
	log.Printf("NEXUS agent %s checking in to %s", Version, cfg.Server)
	for {
		full := time.Since(lastFull) >= 6*time.Hour
		res, err := client.Checkin(full)
		if err != nil {
			log.Printf("check-in failed: %v", err)
		} else {
			if full {
				lastFull = time.Now()
			}
			if override == 0 && res.Interval > 0 {
				every = time.Duration(res.Interval) * time.Second
			}
		}
		time.Sleep(every)
	}
}

func mustLoad(path string) *Config {
	cfg, err := LoadConfig(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "This computer is not enrolled yet (%v).\nRun: nexus-agent enroll --server URL --token CODE\n", err)
		os.Exit(1)
	}
	return cfg
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
