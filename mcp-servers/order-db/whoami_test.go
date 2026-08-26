package main

import (
	"context"
	"encoding/base64"
	"net/http"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// jwtWithPayload builds a syntactically-valid (unsigned) JWT string wrapping
// the given base64url-encoded-free JSON payload, for testing decodeJWTClaims.
func jwtWithPayload(t *testing.T, payloadJSON string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(payloadJSON))
	return header + "." + payload + ".sig"
}

func TestDecodeJWTClaims(t *testing.T) {
	t.Run("valid bearer JWT", func(t *testing.T) {
		token := jwtWithPayload(t, `{"sub":"demo-customer","iss":"https://keycloak.example/realms/retail-returns-customers","aud":"retail-returns-ui"}`)
		claims, err := decodeJWTClaims("Bearer " + token)
		if err != nil {
			t.Fatalf("decodeJWTClaims() error = %v", err)
		}
		if claims["sub"] != "demo-customer" {
			t.Errorf("claims[sub] = %v; want demo-customer", claims["sub"])
		}
		if claims["aud"] != "retail-returns-ui" {
			t.Errorf("claims[aud] = %v; want retail-returns-ui", claims["aud"])
		}
	})

	t.Run("valid JWT without Bearer prefix", func(t *testing.T) {
		token := jwtWithPayload(t, `{"sub":"x"}`)
		claims, err := decodeJWTClaims(token)
		if err != nil {
			t.Fatalf("decodeJWTClaims() error = %v", err)
		}
		if claims["sub"] != "x" {
			t.Errorf("claims[sub] = %v; want x", claims["sub"])
		}
	})

	t.Run("not a JWT", func(t *testing.T) {
		_, err := decodeJWTClaims("Bearer not-a-jwt")
		if err == nil {
			t.Fatal("decodeJWTClaims() error = nil; want error for malformed token")
		}
	})

	t.Run("malformed base64 payload", func(t *testing.T) {
		_, err := decodeJWTClaims("Bearer aaa.!!!not-base64!!!.ccc")
		if err == nil {
			t.Fatal("decodeJWTClaims() error = nil; want error for bad base64")
		}
	})

	t.Run("payload not valid JSON", func(t *testing.T) {
		payload := base64.RawURLEncoding.EncodeToString([]byte("not json"))
		_, err := decodeJWTClaims("Bearer aaa." + payload + ".ccc")
		if err == nil {
			t.Fatal("decodeJWTClaims() error = nil; want error for non-JSON payload")
		}
	})
}

func TestWhoamiTool(t *testing.T) {
	t.Run("no Extra on the request", func(t *testing.T) {
		_, out, err := whoamiTool(context.Background(), &mcp.CallToolRequest{}, struct{}{})
		if err != nil {
			t.Fatalf("whoamiTool() error = %v", err)
		}
		if out.AuthorizationPresent {
			t.Error("AuthorizationPresent = true; want false when Extra is nil")
		}
	})

	t.Run("no Authorization header", func(t *testing.T) {
		req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{Header: http.Header{}}}
		_, out, err := whoamiTool(context.Background(), req, struct{}{})
		if err != nil {
			t.Fatalf("whoamiTool() error = %v", err)
		}
		if out.AuthorizationPresent {
			t.Error("AuthorizationPresent = true; want false when no Authorization header present")
		}
	})

	t.Run("real Authorization header decodes to claims", func(t *testing.T) {
		token := jwtWithPayload(t, `{"sub":"demo-customer"}`)
		header := http.Header{}
		header.Set("Authorization", "Bearer "+token)
		req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{Header: header}}
		_, out, err := whoamiTool(context.Background(), req, struct{}{})
		if err != nil {
			t.Fatalf("whoamiTool() error = %v", err)
		}
		if !out.AuthorizationPresent {
			t.Error("AuthorizationPresent = false; want true")
		}
		if out.Claims["sub"] != "demo-customer" {
			t.Errorf("Claims[sub] = %v; want demo-customer", out.Claims["sub"])
		}
	})
}
