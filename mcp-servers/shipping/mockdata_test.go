package main

import (
	"errors"
	"testing"
)

func TestGetShipmentStatus(t *testing.T) {
	tests := []struct {
		name       string
		orderID    string
		wantStatus string
		wantErr    bool
	}{
		{name: "delivered order", orderID: "ORD-1001", wantStatus: "delivered"},
		{name: "in transit order", orderID: "ORD-1003", wantStatus: "in_transit"},
		{name: "unknown order", orderID: "ORD-9999", wantErr: true},
		{name: "empty order id", orderID: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := getShipmentStatus(tt.orderID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("getShipmentStatus(%q) = %+v, nil; want error", tt.orderID, got)
				}
				var notFound *ErrShipmentNotFound
				if !errors.As(err, &notFound) {
					t.Fatalf("getShipmentStatus(%q) error = %v; want *ErrShipmentNotFound", tt.orderID, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("getShipmentStatus(%q) unexpected error: %v", tt.orderID, err)
			}
			if got.Status != tt.wantStatus {
				t.Errorf("getShipmentStatus(%q).Status = %q; want %q", tt.orderID, got.Status, tt.wantStatus)
			}
		})
	}
}
