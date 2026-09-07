package main

import "testing"

func TestCheckStock(t *testing.T) {
	tests := []struct {
		name          string
		item          string
		wantAvailable int
	}{
		{name: "in stock item", item: "Wireless Headphones", wantAvailable: 12},
		{name: "out of stock item", item: "Mechanical Keyboard", wantAvailable: 0},
		{name: "unknown item defaults to zero", item: "Does Not Exist", wantAvailable: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := checkStock(tt.item)
			if got.Item != tt.item {
				t.Errorf("checkStock(%q).Item = %q; want %q", tt.item, got.Item, tt.item)
			}
			if got.Available != tt.wantAvailable {
				t.Errorf("checkStock(%q).Available = %d; want %d", tt.item, got.Available, tt.wantAvailable)
			}
		})
	}
}
