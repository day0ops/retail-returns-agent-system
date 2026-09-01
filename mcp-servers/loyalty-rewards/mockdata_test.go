package main

import "testing"

func TestGetLoyaltyBalance(t *testing.T) {
	tests := []struct {
		name       string
		customerID string
		wantTier   string
		wantErr    bool
	}{
		{name: "gold customer", customerID: "CUST-100", wantTier: "gold"},
		{name: "platinum customer", customerID: "CUST-102", wantTier: "platinum"},
		{name: "unknown customer", customerID: "CUST-9999", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := getLoyaltyBalance(tt.customerID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("getLoyaltyBalance(%q) = %+v, nil; want error", tt.customerID, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("getLoyaltyBalance(%q) returned unexpected error: %v", tt.customerID, err)
			}
			if got.Tier != tt.wantTier {
				t.Errorf("getLoyaltyBalance(%q).Tier = %q; want %q", tt.customerID, got.Tier, tt.wantTier)
			}
		})
	}
}

func TestAwardPoints(t *testing.T) {
	before, err := getLoyaltyBalance("CUST-103")
	if err != nil {
		t.Fatalf("getLoyaltyBalance(%q) returned unexpected error: %v", "CUST-103", err)
	}

	after, err := awardPoints("CUST-103", 50)
	if err != nil {
		t.Fatalf("awardPoints(%q, 50) returned unexpected error: %v", "CUST-103", err)
	}
	if want := before.Points + 50; after.Points != want {
		t.Errorf("awardPoints(%q, 50).Points = %d; want %d", "CUST-103", after.Points, want)
	}

	if _, err := awardPoints("CUST-103", 0); err == nil {
		t.Errorf("awardPoints(%q, 0) = nil error; want error for non-positive points", "CUST-103")
	}

	if _, err := awardPoints("CUST-9999", 50); err == nil {
		t.Errorf("awardPoints(%q, 50) = nil error; want error for unknown customer", "CUST-9999")
	}
}
