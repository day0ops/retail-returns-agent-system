// Command loyalty-rewards is a mock MCP server exposing two tools over the
// customer data in mockdata.go: get_loyalty_balance and award_points. It has
// no real loyalty platform integration behind it -- this phase of the demo
// only needs the wire protocol to work. Deployed only on the west cluster
// (Phase 10, multicluster) and cataloged into east's AgentRegistry as a
// remote server, to prove a real agent (refund-approval) can call a tool
// that lives on a completely different physical cluster, transparently.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverName = "loyalty-rewards"

// GetLoyaltyBalanceInput is the input schema for the get_loyalty_balance tool.
type GetLoyaltyBalanceInput struct {
	CustomerID string `json:"customer_id" jsonschema:"the customer to look up the loyalty balance for"`
}

// GetLoyaltyBalanceOutput is the output schema for the get_loyalty_balance tool.
type GetLoyaltyBalanceOutput struct {
	Account LoyaltyAccount `json:"account" jsonschema:"the customer's loyalty account"`
}

func getLoyaltyBalanceTool(_ context.Context, _ *mcp.CallToolRequest, in GetLoyaltyBalanceInput) (*mcp.CallToolResult, GetLoyaltyBalanceOutput, error) {
	account, err := getLoyaltyBalance(in.CustomerID)
	if err != nil {
		return nil, GetLoyaltyBalanceOutput{}, err
	}
	return nil, GetLoyaltyBalanceOutput{Account: account}, nil
}

// AwardPointsInput is the input schema for the award_points tool. Takes the
// refund amount rather than a pre-computed point value -- the 10%/minimum-10
// conversion is deterministic arithmetic, done here (see pointsForRefund),
// not left to the calling LLM to get right.
type AwardPointsInput struct {
	CustomerID   string  `json:"customer_id" jsonschema:"the customer to award points to"`
	RefundAmount float64 `json:"refund_amount" jsonschema:"the dollar amount of the refund this goodwill bonus is for; must be positive"`
	Reason       string  `json:"reason" jsonschema:"a short human-readable reason for the award, e.g. return goodwill bonus"`
}

// AwardPointsOutput is the output schema for the award_points tool.
type AwardPointsOutput struct {
	Account LoyaltyAccount `json:"account" jsonschema:"the customer's updated loyalty account"`
	Message string         `json:"message" jsonschema:"a human-readable confirmation"`
}

func awardPointsTool(_ context.Context, _ *mcp.CallToolRequest, in AwardPointsInput) (*mcp.CallToolResult, AwardPointsOutput, error) {
	if in.RefundAmount <= 0 {
		return nil, AwardPointsOutput{}, fmt.Errorf("refund_amount must be positive, got %v", in.RefundAmount)
	}
	points := pointsForRefund(in.RefundAmount)
	account, err := awardPoints(in.CustomerID, points)
	if err != nil {
		return nil, AwardPointsOutput{}, err
	}
	return nil, AwardPointsOutput{
		Account: account,
		Message: fmt.Sprintf(
			"Awarded %d loyalty points to %s (%s). New balance: %d points.",
			points, in.CustomerID, in.Reason, account.Points,
		),
	}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: serverName, Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_loyalty_balance",
		Description: "Look up a customer's current loyalty points balance and tier",
	}, getLoyaltyBalanceTool)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "award_points",
		Description: "Award a loyalty goodwill bonus to a customer for a processed return. Give the refund's dollar amount, not a point value -- the point award (10% of the amount, minimum 10) is computed here.",
	}, awardPointsTool)

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
