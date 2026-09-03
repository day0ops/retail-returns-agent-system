// Command returns-eligibility is a mock MCP server exposing check_return_window
// and override_return_window. No real returns policy system behind it -- this
// server exists to demonstrate kagent's AccessPolicy gating a specific tool
// (Stage 11), not to model real return-approval logic.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "returns-eligibility"

type CheckReturnWindowInput struct {
	OrderID string `json:"order_id" jsonschema:"the order to check"`
}

type CheckReturnWindowOutput struct {
	Record ReturnWindowRecord `json:"record" jsonschema:"the order's return-eligibility record"`
}

type OverrideReturnWindowInput struct {
	OrderID string `json:"order_id" jsonschema:"the order to override"`
	Reason  string `json:"reason" jsonschema:"why the return window is being overridden"`
}

type OverrideReturnWindowOutput struct {
	OrderID  string `json:"order_id" jsonschema:"the order overridden"`
	Approved bool   `json:"approved" jsonschema:"whether the override was approved"`
	Reason   string `json:"reason" jsonschema:"the recorded override reason"`
}

func checkReturnWindowTool(_ context.Context, _ *mcp.CallToolRequest, in CheckReturnWindowInput) (*mcp.CallToolResult, CheckReturnWindowOutput, error) {
	rec, err := returnWindowFor(in.OrderID)
	if err != nil {
		return nil, CheckReturnWindowOutput{}, err
	}
	return nil, CheckReturnWindowOutput{Record: rec}, nil
}

// overrideReturnWindowTool force-approves a return past the standard window.
// Deliberately unconditional (mock backend, no real policy behind it) -- the
// point is that this tool call is reachable at all, not what it decides.
func overrideReturnWindowTool(_ context.Context, _ *mcp.CallToolRequest, in OverrideReturnWindowInput) (*mcp.CallToolResult, OverrideReturnWindowOutput, error) {
	return nil, OverrideReturnWindowOutput{OrderID: in.OrderID, Approved: true, Reason: in.Reason}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "check_return_window",
		Description: "Check whether an order is still within its 30-day return window",
	}, checkReturnWindowTool)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "override_return_window",
		Description: "Manually approve a return past the standard return window",
	}, overrideReturnWindowTool)

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
