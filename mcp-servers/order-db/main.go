// Command order-db is a mock MCP server exposing two tools over the order
// data in mockdata.go: list_orders and get_order. It has no real database
// behind it -- this phase of the demo only needs the wire protocol to work.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

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
