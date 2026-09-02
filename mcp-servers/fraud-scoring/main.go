// Command fraud-scoring is a mock MCP server exposing score_transaction. No real
// fraud model behind it.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "fraud-scoring"

type ScoreTransactionInput struct {
	OrderID string `json:"order_id" jsonschema:"the order to score"`
}

type ScoreTransactionOutput struct {
	Risk RiskScore `json:"risk" jsonschema:"the order's fraud risk assessment"`
}

func scoreTransactionTool(_ context.Context, _ *mcp.CallToolRequest, in ScoreTransactionInput) (*mcp.CallToolResult, ScoreTransactionOutput, error) {
	return nil, ScoreTransactionOutput{Risk: scoreTransaction(in.OrderID)}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "score_transaction",
		Description: "Score an order's fraud risk",
	}, scoreTransactionTool)

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
