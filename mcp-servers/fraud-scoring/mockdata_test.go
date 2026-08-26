package main

import "testing"

func TestScoreTransaction(t *testing.T) {
	tests := []struct {
		name      string
		orderID   string
		wantLevel string
	}{
		{name: "low risk order", orderID: "ORD-1001", wantLevel: "low"},
		{name: "medium risk order", orderID: "ORD-1008", wantLevel: "medium"},
		{name: "high risk order", orderID: "ORD-1007", wantLevel: "high"},
		{name: "unknown order defaults to low risk", orderID: "ORD-9999", wantLevel: "low"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := scoreTransaction(tt.orderID)
			if got.OrderID != tt.orderID {
				t.Errorf("scoreTransaction(%q).OrderID = %q; want %q", tt.orderID, got.OrderID, tt.orderID)
			}
			if got.Level != tt.wantLevel {
				t.Errorf("scoreTransaction(%q).Level = %q (score %v); want %q", tt.orderID, got.Level, got.Score, tt.wantLevel)
			}
		})
	}
}

func TestRiskLevel(t *testing.T) {
	tests := []struct {
		score float64
		want  string
	}{
		{score: 0, want: "low"},
		{score: 0.29, want: "low"},
		{score: 0.3, want: "medium"},
		{score: 0.69, want: "medium"},
		{score: 0.7, want: "high"},
		{score: 1, want: "high"},
	}

	for _, tt := range tests {
		if got := riskLevel(tt.score); got != tt.want {
			t.Errorf("riskLevel(%v) = %q; want %q", tt.score, got, tt.want)
		}
	}
}
