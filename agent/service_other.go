//go:build !darwin && !windows

package main

import "errors"

func installService(string) error {
	return errors.New("automatic start is supported on macOS and Windows; on Linux run `nexus-agent run` under systemd")
}

func uninstallService() error { return nil }
