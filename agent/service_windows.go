//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const taskName = "NEXUS Agent"

func installService(cfgPath string) error {
	if _, err := LoadConfig(cfgPath); err != nil {
		return fmt.Errorf("enroll first: %w", err)
	}
	dir := filepath.Join(os.Getenv("LOCALAPPDATA"), "Nexus")
	bin, err := copySelf(dir, "nexus-agent.exe")
	if err != nil {
		return err
	}
	tr := fmt.Sprintf(`"%s" run --config "%s"`, bin, cfgPath)
	if out, err := exec.Command("schtasks", "/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", taskName, "/TR", tr).CombinedOutput(); err != nil {
		return fmt.Errorf("could not create the startup task: %s", out)
	}
	_ = exec.Command("schtasks", "/Run", "/TN", taskName).Run()
	fmt.Println("NEXUS agent installed. It now checks in in the background and starts at every sign-in.")
	return nil
}

func uninstallService() error {
	_ = exec.Command("schtasks", "/End", "/TN", taskName).Run()
	_ = exec.Command("schtasks", "/Delete", "/F", "/TN", taskName).Run()
	fmt.Println("NEXUS agent will no longer run in the background.")
	return nil
}
