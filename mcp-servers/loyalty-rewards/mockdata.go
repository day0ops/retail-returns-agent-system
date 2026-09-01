package main

import "fmt"

// LoyaltyAccount is a customer's on-file loyalty program status.
type LoyaltyAccount struct {
	CustomerID string `json:"customer_id" jsonschema:"the customer who owns this loyalty account"`
	Points     int    `json:"points" jsonschema:"the customer's current points balance"`
	Tier       string `json:"tier" jsonschema:"the customer's loyalty tier, e.g. silver, gold, platinum"`
}

// mockLoyaltyAccounts is the hardcoded seed data for this demo -- the same
// customer IDs payment-mcp's mock data uses, kept as an independent copy
// here rather than a shared import: this is a genuinely separate service,
// not a shared library between the two. There is no real loyalty platform
// behind this; it exists only to give refund-approval something real to
// look up and act on when it awards a goodwill bonus.
var mockLoyaltyAccounts = []LoyaltyAccount{
	{CustomerID: "CUST-100", Points: 1250, Tier: "gold"},
	{CustomerID: "CUST-101", Points: 320, Tier: "silver"},
	{CustomerID: "CUST-102", Points: 4100, Tier: "platinum"},
	{CustomerID: "CUST-103", Points: 80, Tier: "silver"},
	{CustomerID: "CUST-104", Points: 900, Tier: "gold"},
}

// ErrLoyaltyAccountNotFound is returned by getLoyaltyBalance/awardPoints when
// the given customer ID has no loyalty account on file.
type ErrLoyaltyAccountNotFound struct {
	CustomerID string
}

func (e *ErrLoyaltyAccountNotFound) Error() string {
	return fmt.Sprintf("no loyalty account on file for customer %q", e.CustomerID)
}

// getLoyaltyBalance returns the loyalty account on file for customerID, or
// ErrLoyaltyAccountNotFound if none exists.
func getLoyaltyBalance(customerID string) (LoyaltyAccount, error) {
	for _, a := range mockLoyaltyAccounts {
		if a.CustomerID == customerID {
			return a, nil
		}
	}
	return LoyaltyAccount{}, &ErrLoyaltyAccountNotFound{CustomerID: customerID}
}

// awardPoints adds points to customerID's balance and returns the updated
// account. Mutates the in-memory mock data directly -- there is no real
// ledger behind this, and the demo's server process doesn't need the award
// to survive a restart.
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
