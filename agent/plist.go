// Minimal Apple property-list (XML form) parser.
//
// The agent reads macOS metadata from plists — SystemVersion.plist for
// the OS version, each .app bundle's Info.plist for its real name /
// version / bundle identifier, and `diskutil list -plist` for physical
// disks. There is deliberately no third-party plist dependency: the Go
// standard library's encoding/xml is enough for the XML form, and
// binary plists are converted with `plutil` on macOS before parsing
// (see readPlistFile in macos.go).
//
// The parser is pure — parsePlistXML takes bytes and returns a nested
// map — so it is unit-tested with fixtures on any platform (see
// main_test.go). Only the <dict> root form is returned; <array> roots
// are an error because every plist the agent reads is dict-rooted.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
)

// parsePlistXML parses an XML plist document and returns its root dict.
func parsePlistXML(data []byte) (map[string]any, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("plist: %w", err)
		}
		if se, ok := tok.(xml.StartElement); ok {
			if se.Name.Local == "plist" {
				continue // wrapper element; the root value follows
			}
			v, err := parsePlistValue(dec, se)
			if err != nil {
				return nil, err
			}
			m, ok := v.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("plist root is %T, not a dict", v)
			}
			return m, nil
		}
	}
}

// parsePlistValue parses one plist value element; start is the
// already-read opening tag of that element.
func parsePlistValue(dec *xml.Decoder, start xml.StartElement) (any, error) {
	switch start.Name.Local {
	case "dict":
		return parsePlistDict(dec)
	case "array":
		return parsePlistArray(dec)
	case "string":
		return readPlistText(dec, "string")
	case "integer":
		text, err := readPlistText(dec, "integer")
		if err != nil {
			return nil, err
		}
		n, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("plist integer %q: %w", text, err)
		}
		return n, nil
	case "real":
		text, err := readPlistText(dec, "real")
		if err != nil {
			return nil, err
		}
		f, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
		if err != nil {
			return nil, fmt.Errorf("plist real %q: %w", text, err)
		}
		return f, nil
	case "date":
		return readPlistText(dec, "date")
	case "data":
		text, err := readPlistText(dec, "data")
		if err != nil {
			return nil, err
		}
		b, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(text), ""))
		if err != nil {
			return nil, fmt.Errorf("plist data: %w", err)
		}
		return b, nil
	case "true":
		if _, err := readPlistText(dec, "true"); err != nil {
			return nil, err
		}
		return true, nil
	case "false":
		if _, err := readPlistText(dec, "false"); err != nil {
			return nil, err
		}
		return false, nil
	default:
		return nil, fmt.Errorf("plist: unsupported element <%s>", start.Name.Local)
	}
}

func parsePlistDict(dec *xml.Decoder) (map[string]any, error) {
	m := map[string]any{}
	key := ""
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("plist dict: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "key" {
				text, err := readPlistText(dec, "key")
				if err != nil {
					return nil, err
				}
				key = text
				continue
			}
			if key == "" {
				return nil, fmt.Errorf("plist dict: value without a key")
			}
			v, err := parsePlistValue(dec, t)
			if err != nil {
				return nil, err
			}
			m[key] = v
			key = ""
		case xml.EndElement:
			if t.Name.Local == "dict" {
				return m, nil
			}
			return nil, fmt.Errorf("plist dict: unexpected </%s>", t.Name.Local)
		}
	}
}

func parsePlistArray(dec *xml.Decoder) ([]any, error) {
	var arr []any
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("plist array: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			v, err := parsePlistValue(dec, t)
			if err != nil {
				return nil, err
			}
			arr = append(arr, v)
		case xml.EndElement:
			if t.Name.Local == "array" {
				return arr, nil
			}
			return nil, fmt.Errorf("plist array: unexpected </%s>", t.Name.Local)
		}
	}
}

// readPlistText collects the character data up to the matching end tag.
func readPlistText(dec *xml.Decoder, name string) (string, error) {
	var sb strings.Builder
	for {
		tok, err := dec.Token()
		if err != nil {
			return "", fmt.Errorf("plist <%s>: %w", name, err)
		}
		switch t := tok.(type) {
		case xml.CharData:
			sb.WriteString(string(t))
		case xml.EndElement:
			if t.Name.Local == name {
				return sb.String(), nil
			}
			return "", fmt.Errorf("plist <%s>: unexpected </%s>", name, t.Name.Local)
		}
	}
}

// plistString returns a string value from a parsed plist dict, or "".
func plistString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// plistInt returns an integer value from a parsed plist dict, accepting
// integer, real, or numeric-string forms. ok is false when absent.
func plistInt(m map[string]any, key string) (int64, bool) {
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case int64:
		return n, true
	case float64:
		return int64(n), true
	case string:
		if parsed, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

// plistBool returns a boolean value from a parsed plist dict, or false.
func plistBool(m map[string]any, key string) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

// plistArray returns an array value from a parsed plist dict, or nil.
func plistArray(m map[string]any, key string) []any {
	if v, ok := m[key]; ok {
		if arr, ok := v.([]any); ok {
			return arr
		}
	}
	return nil
}
