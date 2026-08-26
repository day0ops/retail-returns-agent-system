// Command fraud-scoring is a mock MCP server exposing one tool over the risk
// data in mockdata.go: score_transaction. It has no real fraud model behind
// it -- this phase of the demo only needs the wire protocol to work.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "fraud-scoring"

// ScoreTransactionInput is the input schema for the score_transaction tool.
type ScoreTransactionInput struct {
	OrderID string `json:"order_id" jsonschema:"the order to score"`
}

// ScoreTransactionOutput is the output schema for the score_transaction tool.
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
