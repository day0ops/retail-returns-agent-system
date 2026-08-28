package main

import "testing"

func TestRedactText(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "email", in: "contact jane.doe@example.com for details", want: "contact [REDACTED_EMAIL] for details"},
		{name: "phone", in: "call 555-100-1000 now", want: "call [REDACTED_PHONE] now"},
		{name: "both, json-encoded string", in: `{"customer_email":"jane.doe@example.com","customer_phone":"555-100-1000"}`, want: `{"customer_email":"[REDACTED_EMAIL]","customer_phone":"[REDACTED_PHONE]"}`},
		{name: "no PII", in: "Wireless Headphones", want: "Wireless Headphones"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := redactText(tt.in); got != tt.want {
				t.Errorf("redactText(%q) = %q; want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestRedactValue(t *testing.T) {
	in := map[string]any{
		"order": map[string]any{
			"order_id":       "ORD-1001",
			"customer_email": "jane.doe@example.com",
			"customer_phone": "555-100-1000",
			"item":           "Wireless Headphones",
		},
		"content": []any{
			map[string]any{
				"type": "text",
				"text": `{"order":{"customer_email":"jane.doe@example.com","customer_phone":"555-100-1000"}}`,
			},
		},
	}

	out, changed := redactValue(in)
	if !changed {
		t.Fatal("redactValue reported no change; want a redaction")
	}

	order := out.(map[string]any)["order"].(map[string]any)
	if order["customer_email"] != "[REDACTED_EMAIL]" {
		t.Errorf("order.customer_email = %v; want [REDACTED_EMAIL]", order["customer_email"])
	}
	if order["customer_phone"] != "[REDACTED_PHONE]" {
		t.Errorf("order.customer_phone = %v; want [REDACTED_PHONE]", order["customer_phone"])
	}
	if order["order_id"] != "ORD-1001" {
		t.Errorf("order.order_id = %v; want unchanged ORD-1001", order["order_id"])
	}

	text := out.(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
	want := `{"order":{"customer_email":"[REDACTED_EMAIL]","customer_phone":"[REDACTED_PHONE]"}}`
	if text != want {
		t.Errorf("content[0].text = %q; want %q", text, want)
	}

	unchanged := map[string]any{"item": "Wireless Headphones"}
	if _, changed := redactValue(unchanged); changed {
		t.Error("redactValue reported a change for PII-free input")
	}
}
