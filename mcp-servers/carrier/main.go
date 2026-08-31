// Command carrier is a mock MCP server exposing one tool over the
// order/carrier data in mockdata.go: link_carrier_account. It has no real
// carrier integration behind it -- this phase of the demo only needs the
// wire protocol to work. Deliberately a separate server, not a second tool
// on shipping-mcp: shipping-mcp's get_shipment_status is called
// unconditionally by order-lookup as part of the existing Stage 3/4/6/7 A2A
// chain, and agentgateway's entElicitation gates at the whole-Backend level,
// not per-tool -- putting link_carrier_account on shipping's own Backend
// would have required carrier OAuth consent before any of those existing
// stages could run at all. A dedicated Backend for this tool keeps that gate
// scoped to Stage 9 alone.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "carrier"

// LinkCarrierAccountInput is the input schema for the link_carrier_account tool.
type LinkCarrierAccountInput struct {
	OrderID string `json:"order_id" jsonschema:"the order needing carrier pickup scheduled"`
}

// LinkCarrierAccountOutput is the output schema for the link_carrier_account tool.
type LinkCarrierAccountOutput struct {
	Linked  bool   `json:"linked" jsonschema:"whether the customer's carrier account is now linked"`
	Carrier string `json:"carrier" jsonschema:"the carrier the account was linked to"`
	Message string `json:"message" jsonschema:"a human-readable confirmation"`
}

func linkCarrierAccountTool(_ context.Context, _ *mcp.CallToolRequest, in LinkCarrierAccountInput) (*mcp.CallToolResult, LinkCarrierAccountOutput, error) {
	carrier, err := carrierForOrder(in.OrderID)
	if err != nil {
		return nil, LinkCarrierAccountOutput{}, err
	}
	return nil, LinkCarrierAccountOutput{
		Linked:  true,
		Carrier: carrier,
		Message: fmt.Sprintf(
			"Carrier account linked with %s for order %s; pickup can now be scheduled.",
			carrier, in.OrderID,
		),
	}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "link_carrier_account",
		Description: "Link the customer's carrier account so a pickup can be scheduled for this order",
	}, linkCarrierAccountTool)

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
