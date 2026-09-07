package main

import (
	"errors"
	"testing"
)

func TestGetPaymentMethod(t *testing.T) {
	tests := []struct {
		name       string
		customerID string
		wantType   string
		wantErr    bool
	}{
		{name: "known customer", customerID: "CUST-100", wantType: "credit_card"},
		{name: "another known customer", customerID: "CUST-101", wantType: "paypal"},
		{name: "unknown customer", customerID: "CUST-999", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := getPaymentMethod(tt.customerID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("getPaymentMethod(%q) = %+v, nil; want error", tt.customerID, got)
				}
				var notFound *ErrPaymentMethodNotFound
				if !errors.As(err, &notFound) {
					t.Fatalf("getPaymentMethod(%q) error = %v; want *ErrPaymentMethodNotFound", tt.customerID, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("getPaymentMethod(%q) unexpected error: %v", tt.customerID, err)
			}
			if got.Type != tt.wantType {
				t.Errorf("getPaymentMethod(%q).Type = %q; want %q", tt.customerID, got.Type, tt.wantType)
			}
		})
	}
}

func TestRefundPayment(t *testing.T) {
	tests := []struct {
		name    string
		orderID string
		amount  float64
		wantErr bool
	}{
		{name: "valid refund", orderID: "ORD-1001", amount: 89.99},
		{name: "empty order id", orderID: "", amount: 10, wantErr: true},
		{name: "zero amount", orderID: "ORD-1001", amount: 0, wantErr: true},
		{name: "negative amount", orderID: "ORD-1001", amount: -5, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := refundPayment(tt.orderID, tt.amount)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("refundPayment(%q, %v) = %+v, nil; want error", tt.orderID, tt.amount, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("refundPayment(%q, %v) unexpected error: %v", tt.orderID, tt.amount, err)
			}
			if got.Status != "refunded" {
				t.Errorf("refundPayment(%q, %v).Status = %q; want %q", tt.orderID, tt.amount, got.Status, "refunded")
			}
			if got.Amount != tt.amount {
				t.Errorf("refundPayment(%q, %v).Amount = %v; want %v", tt.orderID, tt.amount, got.Amount, tt.amount)
			}
		})
	}
}
