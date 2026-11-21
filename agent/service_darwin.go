//go:build darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

const launchLabel = "com.nexus.agent"

func plistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", launchLabel+".plist")
}

func installService(cfgPath string) error {
	if _, err := LoadConfig(cfgPath); err != nil {
		return fmt.Errorf("enroll first: %w", err)
	}
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, "Library", "Application Support", "Nexus")
	bin, err := copySelf(dir, "nexus-agent")
	if err != nil {
		return err
	}
	logPath := filepath.Join(home, "Library", "Logs", "nexus-agent.log")
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key><array><string>%s</string><string>run</string><string>--config</string><string>%s</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict></plist>
`, launchLabel, bin, cfgPath, logPath, logPath)
	if err := os.MkdirAll(filepath.Dir(plistPath()), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(plistPath(), []byte(plist), 0o644); err != nil {
		return err
	}
	domain := "gui/" + strconv.Itoa(os.Getuid())
	_ = exec.Command("launchctl", "bootout", domain+"/"+launchLabel).Run()
	if out, err := exec.Command("launchctl", "bootstrap", domain, plistPath()).CombinedOutput(); err != nil {
		return fmt.Errorf("could not start the background agent: %s", out)
	}
	fmt.Println("NEXUS agent installed. It now checks in in the background and starts at every login.")
	fmt.Println("Log file:", logPath)
	return nil
}

func uninstallService() error {
	_ = exec.Command("launchctl", "bootout", "gui/"+strconv.Itoa(os.Getuid())+"/"+launchLabel).Run()
	_ = os.Remove(plistPath())
	fmt.Println("NEXUS agent will no longer run in the background.")
	return nil
}
