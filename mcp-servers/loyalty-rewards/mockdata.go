package main

import (
	"fmt"
	"math"
)

// LoyaltyAccount is a customer's on-file loyalty program status.
type LoyaltyAccount struct {
	CustomerID string `json:"customer_id" jsonschema:"the customer who owns this loyalty account"`
	Points     int    `json:"points" jsonschema:"the customer's current points balance"`
	Tier       string `json:"tier" jsonschema:"the customer's loyalty tier, e.g. silver, gold, platinum"`
}

// mockLoyaltyAccounts is the demo seed data. Uses the same customer IDs as
// payment-mcp's mock data but keeps an independent copy on purpose: this is a
// separate service, not a shared library.
var mockLoyaltyAccounts = []LoyaltyAccount{
	{CustomerID: "CUST-100", Points: 1250, Tier: "gold"},
	{CustomerID: "CUST-101", Points: 320, Tier: "silver"},
	{CustomerID: "CUST-102", Points: 4100, Tier: "platinum"},
	{CustomerID: "CUST-103", Points: 80, Tier: "silver"},
	{CustomerID: "CUST-104", Points: 900, Tier: "gold"},
}

// ErrLoyaltyAccountNotFound means the customer ID has no loyalty account on file.
type ErrLoyaltyAccountNotFound struct {
	CustomerID string
}

func (e *ErrLoyaltyAccountNotFound) Error() string {
	return fmt.Sprintf("no loyalty account on file for customer %q", e.CustomerID)
}

// getLoyaltyBalance returns the account for customerID, or ErrLoyaltyAccountNotFound.
func getLoyaltyBalance(customerID string) (LoyaltyAccount, error) {
	for _, a := range mockLoyaltyAccounts {
		if a.CustomerID == customerID {
			return a, nil
		}
	}
	return LoyaltyAccount{}, &ErrLoyaltyAccountNotFound{CustomerID: customerID}
}

// pointsForRefund computes goodwill-bonus points: 10% of the refund, rounded,
// floored at 10. Done here, not by the calling LLM: live-tested, an LLM applying
// "10%, rounded, minimum 10" in one step drops the minimum on small amounts
// (e.g. $12.50 -> 1 point instead of 10).
func pointsForRefund(refundAmount float64) int {
	points := int(math.Round(refundAmount * 0.10))
	if points < 10 {
		return 10
	}
	return points
}

// awardPoints adds points to customerID's balance and returns the updated
// account. Mutates the in-memory mock data directly; awards don't survive a restart.
func awardPoints(customerID string, points int) (LoyaltyAccount, error) {
	if points <= 0 {
		return LoyaltyAccount{}, fmt.Errorf("points must be positive, got %v", points)
	}
	for i, a := range mockLoyaltyAccounts {
		if a.CustomerID == customerID {
			mockLoyaltyAccounts[i].Points += points
			return mockLoyaltyAccounts[i], nil
		}
	}
	return LoyaltyAccount{}, &ErrLoyaltyAccountNotFound{CustomerID: customerID}
}
