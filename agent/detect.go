// Codespace port-privacy detection — agent v0.3.2.
//
// Root cause found Nov 21, 2026: the Mac agent's credential was FINE —
// the backend logs proved its requests never reached the backend at
// all. Ports 8000/5173 had flipped back to Private when the backend
// container was rebuilt, so the agent hit GitHub's port-forward
// sign-in wall: POSTs came back 401 and the GET command poll came back
// as the GitHub sign-in HTML page. The agent logged a bare
// "heartbeat failed (HTTP 401)", which looked like a bad credential.
//
// Every API call the agent makes expects JSON (or an empty 204). An
// HTML body, or a redirect that lands on a github.dev / github.com
// host, means the request hit the sign-in wall instead of the backend.
// Detect that shape and log an ACTIONABLE message with the fix,
// instead of the bare 401 / JSON-parse error.
//
// This deliberately does NOT change the enrollment / device-auth
// protocol: same endpoints, same headers, same payloads. A genuine
// 401 with a JSON body (a truly bad credential) still surfaces as a
// plain 401 — only the HTML/redirect shape triggers the hint.
package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const portPrivacyHint = "the request reached a GitHub sign-in page instead of the NEXUS backend — " +
	"the Codespace port is probably Private; set ports 8000 and 5173 to Public " +
	"in the Codespace Ports panel, then retry (the device credential itself is not the problem)"

// isSignInWall reports whether an HTTP response looks like GitHub's
// port-forward sign-in wall rather than a backend answer: the body is
// HTML where JSON was expected, or the request was redirected to a
// github.dev / github.com host. status is the response status, body
// the full response body, finalURL the URL after redirects, requestURL
// the URL that was requested.
func isSignInWall(status int, body []byte, finalURL, requestURL string) bool {
	trimmed := bytes.TrimSpace(body)
	lower := bytes.ToLower(trimmed)
	if bytes.HasPrefix(lower, []byte("<!doctype html")) || bytes.HasPrefix(lower, []byte("<html")) {
		return true
	}
	if finalURL != "" && requestURL != "" {
		fu, err1 := url.Parse(finalURL)
		ru, err2 := url.Parse(requestURL)
		if err1 == nil && err2 == nil {
			host := strings.ToLower(fu.Hostname())
			if host == "github.com" || host == "github.dev" || strings.HasSuffix(host, ".github.dev") {
				// Landed on GitHub itself instead of the backend.
				// (A redirect back to the same backend host is fine;
				// a redirect to a *different* non-GitHub host is not
				// the sign-in wall, so it is left alone.)
				_ = ru
				return true
			}
		}
	}
	return false
}

// checkBackendResponse inspects a response the agent just received from
// what should be the NEXUS backend. It returns a non-nil error when
// the response is the sign-in wall (see isSignInWall), with the
// actionable hint; otherwise nil. Callers log the returned error,
// which is how the operator sees the hint.
func checkBackendResponse(resp *http.Response, body []byte, requestURL string) error {
	finalURL := ""
	if resp != nil && resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	if isSignInWall(status, body, finalURL, requestURL) {
		return fmt.Errorf("backend unreachable: %s (HTTP %d, HTML sign-in page received)", portPrivacyHint, status)
	}
	return nil
}
