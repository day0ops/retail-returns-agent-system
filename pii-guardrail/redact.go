package main

import "regexp"

var (
	emailPattern = regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
	phonePattern = regexp.MustCompile(`\b\d{3}-\d{3}-\d{4}\b`)
)

// redactText replaces emails and phone numbers in s with marker strings, so a
// redaction is visibly obvious in a live demo rather than silently absent.
func redactText(s string) string {
	s = emailPattern.ReplaceAllString(s, "[REDACTED_EMAIL]")
	s = phonePattern.ReplaceAllString(s, "[REDACTED_PHONE]")
	return s
}

// redactValue walks a decoded JSON value and redacts every string leaf at any
// depth. MCP tool results carry the same data twice -- as a nested object
// (structuredContent) and as a JSON-encoded string (content[].text) -- so
// redacting every leaf handles both without special-casing or re-parsing.
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
