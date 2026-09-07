package main

import "testing"

func TestReturnWindowFor(t *testing.T) {
	tests := []struct {
		name       string
		orderID    string
		wantWithin bool
		wantErr    bool
	}{
		{name: "outside window", orderID: "ORD-1004", wantWithin: false},
		{name: "within window", orderID: "ORD-1006", wantWithin: true},
		{name: "unknown order", orderID: "ORD-9999", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := returnWindowFor(tt.orderID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("returnWindowFor(%q) = %+v, nil; want error", tt.orderID, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("returnWindowFor(%q) returned unexpected error: %v", tt.orderID, err)
			}
			if got.WithinWindow != tt.wantWithin {
				t.Errorf("returnWindowFor(%q).WithinWindow = %v; want %v", tt.orderID, got.WithinWindow, tt.wantWithin)
			}
		})
	}
}
