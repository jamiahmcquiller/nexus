package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	Server string
	cfg    *Config
	http   *http.Client
}

func newHTTPClient() *http.Client { return &http.Client{Timeout: 60 * time.Second} }

func NewClient(cfg *Config) *Client {
	return &Client{Server: cfg.Server, cfg: cfg, http: newHTTPClient()}
}

type EnrollResult struct {
	AgentKey string `json:"agent_key"`
	Interval int    `json:"checkin_interval_seconds"`
}

type CheckinResult struct {
	Status   string `json:"status"`
	Interval int    `json:"checkin_interval_seconds"`
}

func (c *Client) post(path string, body any, out any, headers map[string]string) error {
	b, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", c.Server+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nexus-agent/"+Version)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach %s: %w", c.Server, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		var e struct {
			Detail any `json:"detail"`
		}
		if json.Unmarshal(data, &e) == nil && e.Detail != nil {
			return fmt.Errorf("server said: %v", e.Detail)
		}
		snippet := string(data)
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return fmt.Errorf("server returned %s: %s", resp.Status, snippet)
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("unexpected reply from server (is the address right?): %w", err)
		}
	}
	return nil
}

func (c *Client) Enroll(token, deviceID string, inv *Inventory) (*EnrollResult, error) {
	var res EnrollResult
	err := c.post("/api/v1/agent/enroll", map[string]any{
		"enrollment_token": token, "device_id": deviceID, "hostname": inv.Hostname,
		"agent_version": Version, "attributes": inv.Attributes(),
	}, &res, nil)
	return &res, err
}

// Checkin reports liveness; with full=true it also sends a fresh inventory.
func (c *Client) Checkin(full bool) (*CheckinResult, error) {
	body := map[string]any{"agent_version": Version}
	if full {
		inv := Collect()
		body["hostname"] = inv.Hostname
		body["inventory"] = inv.Attributes()
	}
	var res CheckinResult
	err := c.post("/api/v1/agent/checkin", body, &res, map[string]string{
		"X-Device-ID": c.cfg.DeviceID, "Authorization": "Bearer " + c.cfg.AgentKey,
	})
	return &res, err
}
