// Command shipping is a mock MCP server exposing get_shipment_status. No real
// carrier integration behind it.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "shipping"

type GetShipmentStatusInput struct {
	OrderID string `json:"order_id" jsonschema:"the order to look up the shipment for"`
}

type GetShipmentStatusOutput struct {
	Shipment Shipment `json:"shipment" jsonschema:"the matching shipment"`
}

func getShipmentStatusTool(_ context.Context, _ *mcp.CallToolRequest, in GetShipmentStatusInput) (*mcp.CallToolResult, GetShipmentStatusOutput, error) {
	shipment, err := getShipmentStatus(in.OrderID)
	if err != nil {
		return nil, GetShipmentStatusOutput{}, err
	}
	return nil, GetShipmentStatusOutput{Shipment: shipment}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_shipment_status",
		Description: "Look up a shipment's carrier and status by order ID",
	}, getShipmentStatusTool)

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
