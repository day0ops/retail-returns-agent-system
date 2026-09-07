package main

import "testing"

func TestEnvOr(t *testing.T) {
	const key = "FRAUD_CHECK_TEST_ENV_OR"

	t.Run("uses the environment value when set", func(t *testing.T) {
		t.Setenv(key, "from-env")
		if got := envOr(key, "fallback"); got != "from-env" {
			t.Errorf("envOr(%q, fallback) = %q; want %q", key, got, "from-env")
		}
	})

	t.Run("falls back when unset", func(t *testing.T) {
		if got := envOr(key, "fallback"); got != "fallback" {
			t.Errorf("envOr(%q, fallback) = %q; want %q", key, got, "fallback")
		}
	})

	t.Run("falls back when set to empty string", func(t *testing.T) {
		t.Setenv(key, "")
		if got := envOr(key, "fallback"); got != "fallback" {
			t.Errorf("envOr(%q, fallback) = %q; want %q", key, got, "fallback")
		}
	})
}
