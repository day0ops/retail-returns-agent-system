package main

import "regexp"

var (
	emailPattern = regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
	phonePattern = regexp.MustCompile(`\b\d{3}-\d{3}-\d{4}\b`)
)

// redactText replaces email addresses and phone numbers found anywhere in s
// with marker strings, so a redaction is visibly obvious in a live demo
// rather than silently absent.
func redactText(s string) string {
	s = emailPattern.ReplaceAllString(s, "[REDACTED_EMAIL]")
	s = phonePattern.ReplaceAllString(s, "[REDACTED_PHONE]")
	return s
}

// redactValue walks a JSON value (as decoded by encoding/json into
// interface{}) and redacts every string leaf it finds, at any depth. MCP tool
// results carry the same data twice -- once as a real nested object
// (structuredContent) and once as a JSON-encoded string (content[].text) --
// redacting every string leaf handles both without needing to special-case
// either shape or re-parse the inner JSON string.
func redactValue(v any) (any, bool) {
	switch val := v.(type) {
	case string:
		redacted := redactText(val)
		return redacted, redacted != val
	case map[string]any:
		changed := false
		for k, child := range val {
			newChild, childChanged := redactValue(child)
			if childChanged {
				val[k] = newChild
				changed = true
			}
		}
		return val, changed
	case []any:
		changed := false
		for i, child := range val {
			newChild, childChanged := redactValue(child)
			if childChanged {
				val[i] = newChild
				changed = true
			}
		}
		return val, changed
	default:
		return v, false
	}
}
