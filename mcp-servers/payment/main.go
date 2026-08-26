// Command payment is a mock MCP server exposing two tools over the payment
// data in mockdata.go: get_payment_method and refund_payment. It has no real
// payment processor behind it -- this phase of the demo only needs the wire
// protocol to work.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "payment"

// GetPaymentMethodInput is the input schema for the get_payment_method tool.
type GetPaymentMethodInput struct {
	CustomerID string `json:"customer_id" jsonschema:"the customer to look up the payment method for"`
}

// GetPaymentMethodOutput is the output schema for the get_payment_method tool.
type GetPaymentMethodOutput struct {
	PaymentMethod PaymentMethod `json:"payment_method" jsonschema:"the customer's payment method on file"`
}

// RefundPaymentInput is the input schema for the refund_payment tool.
type RefundPaymentInput struct {
	OrderID string  `json:"order_id" jsonschema:"the order to refund"`
	Amount  float64 `json:"amount" jsonschema:"the amount to refund, in USD"`
}

// RefundPaymentOutput is the output schema for the refund_payment tool.
type RefundPaymentOutput struct {
	Refund RefundResult `json:"refund" jsonschema:"the refund result"`
}

func getPaymentMethodTool(_ context.Context, _ *mcp.CallToolRequest, in GetPaymentMethodInput) (*mcp.CallToolResult, GetPaymentMethodOutput, error) {
	method, err := getPaymentMethod(in.CustomerID)
	if err != nil {
		return nil, GetPaymentMethodOutput{}, err
	}
	return nil, GetPaymentMethodOutput{PaymentMethod: method}, nil
}

func refundPaymentTool(_ context.Context, _ *mcp.CallToolRequest, in RefundPaymentInput) (*mcp.CallToolResult, RefundPaymentOutput, error) {
	result, err := refundPayment(in.OrderID, in.Amount)
	if err != nil {
		return nil, RefundPaymentOutput{}, err
	}
	return nil, RefundPaymentOutput{Refund: result}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_payment_method",
		Description: "Look up a customer's payment method on file",
	}, getPaymentMethodTool)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "refund_payment",
		Description: "Issue a refund for an order",
	}, refundPaymentTool)

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
