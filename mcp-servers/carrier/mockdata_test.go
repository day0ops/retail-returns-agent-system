package main

import "testing"

func TestCarrierForOrder(t *testing.T) {
	tests := []struct {
		name        string
		orderID     string
		wantCarrier string
		wantErr     bool
	}{
		{name: "fastship order", orderID: "ORD-1001", wantCarrier: "FastShip"},
		{name: "parcelpro order", orderID: "ORD-1003", wantCarrier: "ParcelPro"},
		{name: "unknown order", orderID: "ORD-9999", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := carrierForOrder(tt.orderID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("carrierForOrder(%q) = %q, nil; want error", tt.orderID, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("carrierForOrder(%q) returned unexpected error: %v", tt.orderID, err)
			}
			if got != tt.wantCarrier {
				t.Errorf("carrierForOrder(%q) = %q; want %q", tt.orderID, got, tt.wantCarrier)
			}
		})
	}
}
