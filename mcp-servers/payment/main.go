// Command payment is a mock MCP server exposing get_payment_method and
// refund_payment. No real payment processor behind it.
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "payment"

type GetPaymentMethodInput struct {
	CustomerID string `json:"customer_id" jsonschema:"the customer to look up the payment method for"`
}

type GetPaymentMethodOutput struct {
	PaymentMethod PaymentMethod `json:"payment_method" jsonschema:"the customer's payment method on file"`
}

type RefundPaymentInput struct {
	OrderID string  `json:"order_id" jsonschema:"the order to refund"`
	Amount  float64 `json:"amount" jsonschema:"the amount to refund, in USD"`
}

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
