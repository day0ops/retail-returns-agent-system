package main

import (
	"errors"
	"testing"
)

func TestGetOrderByID(t *testing.T) {
	tests := []struct {
		name    string
		orderID string
		want    string // expected Item, empty if an error is expected
		wantErr bool
	}{
		{name: "known order", orderID: "ORD-1001", want: "Wireless Headphones"},
		{name: "another known order", orderID: "ORD-1004", want: "Mechanical Keyboard"},
		{name: "unknown order", orderID: "ORD-9999", wantErr: true},
		{name: "empty order id", orderID: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := getOrderByID(tt.orderID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("getOrderByID(%q) = %+v, nil; want error", tt.orderID, got)
				}
				var notFound *ErrOrderNotFound
				if !errors.As(err, &notFound) {
					t.Fatalf("getOrderByID(%q) error = %v; want *ErrOrderNotFound", tt.orderID, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("getOrderByID(%q) unexpected error: %v", tt.orderID, err)
			}
			if got.Item != tt.want {
				t.Errorf("getOrderByID(%q).Item = %q; want %q", tt.orderID, got.Item, tt.want)
			}
		})
	}
}

func TestListOrdersByCustomer(t *testing.T) {
	tests := []struct {
		name       string
		customerID string
		wantCount  int
	}{
		{name: "customer with multiple orders", customerID: "CUST-100", wantCount: 2},
		{name: "customer with one order", customerID: "CUST-103", wantCount: 1},
		{name: "unknown customer", customerID: "CUST-999", wantCount: 0},
		{name: "empty customer id returns all orders", customerID: "", wantCount: len(mockOrders)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := listOrdersByCustomer(tt.customerID)
			if len(got) != tt.wantCount {
				t.Errorf("listOrdersByCustomer(%q) returned %d orders; want %d", tt.customerID, len(got), tt.wantCount)
			}
			for _, o := range got {
				if tt.customerID != "" && o.CustomerID != tt.customerID {
					t.Errorf("listOrdersByCustomer(%q) returned order for customer %q", tt.customerID, o.CustomerID)
				}
			}
		})
	}
}
