// Command order-db is a mock MCP server exposing two tools over the order
// data in mockdata.go: list_orders and get_order. It has no real database
// behind it -- this phase of the demo only needs the wire protocol to work.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "order-db"

// ListOrdersInput is the input schema for the list_orders tool.
type ListOrdersInput struct {
	CustomerID string `json:"customer_id" jsonschema:"the customer to list orders for"`
}

// ListOrdersOutput is the output schema for the list_orders tool.
type ListOrdersOutput struct {
	Orders []Order `json:"orders" jsonschema:"the customer's orders"`
}

// GetOrderInput is the input schema for the get_order tool.
type GetOrderInput struct {
	OrderID string `json:"order_id" jsonschema:"the order to look up"`
}

// GetOrderOutput is the output schema for the get_order tool.
type GetOrderOutput struct {
	Order Order `json:"order" jsonschema:"the matching order"`
}

func listOrdersTool(_ context.Context, _ *mcp.CallToolRequest, in ListOrdersInput) (*mcp.CallToolResult, ListOrdersOutput, error) {
	return nil, ListOrdersOutput{Orders: listOrdersByCustomer(in.CustomerID)}, nil
}

func getOrderTool(_ context.Context, _ *mcp.CallToolRequest, in GetOrderInput) (*mcp.CallToolResult, GetOrderOutput, error) {
	order, err := getOrderByID(in.OrderID)
	if err != nil {
		return nil, GetOrderOutput{}, err
	}
	return nil, GetOrderOutput{Order: order}, nil
}

// WhoamiOutput is the output schema for the whoami diagnostic tool.
type WhoamiOutput struct {
	AuthorizationPresent bool           `json:"authorization_present" jsonschema:"whether an Authorization header was received on this request"`
	Claims               map[string]any `json:"claims,omitempty" jsonschema:"decoded (unverified) JWT claims from the received token, if present and well-formed"`
}

// whoamiTool is a Stage-2-only diagnostic: it decodes and returns the claims of
// whatever bearer token this server actually received on the wire. It exists so
// the guided-tour UI can show, side by side, the customer's original token vs.
// what order-db received after agentgateway's token exchange -- proving the
// exchange actually happened rather than just being configured. No signature
// verification is performed; this is a display aid, not an auth check.
func whoamiTool(_ context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, WhoamiOutput, error) {
	if req.Extra == nil || req.Extra.Header == nil {
		return nil, WhoamiOutput{}, nil
	}
	authHeader := req.Extra.Header.Get("Authorization")
	if authHeader == "" {
		return nil, WhoamiOutput{}, nil
	}
	claims, err := decodeJWTClaims(authHeader)
	if err != nil {
		// Malformed/non-JWT token: still report that something arrived, just no claims.
		return nil, WhoamiOutput{AuthorizationPresent: true}, nil
	}
	return nil, WhoamiOutput{AuthorizationPresent: true, Claims: claims}, nil
}

// decodeJWTClaims base64url-decodes a JWT's payload segment and parses it as
// JSON. It does not verify the signature -- callers must not treat the result
// as authenticated identity, only as a display value.
func decodeJWTClaims(authHeader string) (map[string]any, error) {
	token := strings.TrimPrefix(authHeader, "Bearer ")
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("not a JWT: expected 3 dot-separated parts, got %d", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decoding JWT payload: %w", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("parsing JWT claims: %w", err)
	}
	return claims, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_orders",
		Description: "List a customer's orders by customer ID",
	}, listOrdersTool)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_order",
		Description: "Look up a single order by order ID",
	}, getOrderTool)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "whoami",
		Description: "Diagnostic: decode the Authorization header this server actually received, to prove token exchange happened (guided-tour Stage 2)",
	}, whoamiTool)

	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, nil)

	mux := http.NewServeMux()
	mux.Handle("/mcp", handler)

	addr := ":" + envOr("PORT", "8080")
	log.Printf("%s MCP server listening on %s (POST /mcp)", serverName, addr)
	if err := http.ListenAndServe(addr, mux); err != nil { //nolint:gosec // demo server, no need for custom timeouts
		log.Fatalf("server error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
