package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Server     string `json:"server"`
	DeviceID   string `json:"device_id"`
	AgentKey   string `json:"agent_key"`
	EnrolledAt string `json:"enrolled_at"`
}

func defaultConfigPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "Nexus", "agent.json")
}

func LoadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	return &c, json.Unmarshal(b, &c)
}

// Save writes the config readable only by the current user, since it holds the device key.
func (c *Config) Save(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(path, b, 0o600)
}
