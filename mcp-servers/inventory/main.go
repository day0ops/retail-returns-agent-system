// Command inventory is a mock MCP server exposing check_stock. No real warehouse
// system behind it.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "inventory"

type CheckStockInput struct {
	Item string `json:"item" jsonschema:"the item to check stock for"`
}

type CheckStockOutput struct {
	Stock StockLevel `json:"stock" jsonschema:"the item's current stock level"`
}

func checkStockTool(_ context.Context, _ *mcp.CallToolRequest, in CheckStockInput) (*mcp.CallToolResult, CheckStockOutput, error) {
	return nil, CheckStockOutput{Stock: checkStock(in.Item)}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "check_stock",
		Description: "Check how many units of an item are currently in stock",
	}, checkStockTool)

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
