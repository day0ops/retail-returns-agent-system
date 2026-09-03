package main

import "fmt"

// ReturnWindowRecord is a single order's return-eligibility record from the
// returns-eligibility mock backend. No real returns policy system behind it.
type ReturnWindowRecord struct {
	OrderID           string `json:"order_id" jsonschema:"the order this record is for"`
	PurchaseDate      string `json:"purchase_date" jsonschema:"the order's purchase date, in YYYY-MM-DD format"`
	DaysSincePurchase int    `json:"days_since_purchase" jsonschema:"days elapsed since purchase"`
	WithinWindow      bool   `json:"within_window" jsonschema:"whether the order is still within the 30-day return window"`
}

// mockReturnWindows is the demo seed data; there is no real returns policy
// system behind it. Shares order IDs with order-db's mock data for narrative
// consistency across the guided tour.
var mockReturnWindows = map[string]ReturnWindowRecord{
	"ORD-1001": {OrderID: "ORD-1001", PurchaseDate: "2026-07-02", DaysSincePurchase: 63, WithinWindow: false},
	"ORD-1002": {OrderID: "ORD-1002", PurchaseDate: "2026-07-15", DaysSincePurchase: 50, WithinWindow: false},
	"ORD-1003": {OrderID: "ORD-1003", PurchaseDate: "2026-08-01", DaysSincePurchase: 33, WithinWindow: false},
	"ORD-1004": {OrderID: "ORD-1004", PurchaseDate: "2026-07-20", DaysSincePurchase: 45, WithinWindow: false},
	"ORD-1005": {OrderID: "ORD-1005", PurchaseDate: "2026-06-28", DaysSincePurchase: 67, WithinWindow: false},
	"ORD-1006": {OrderID: "ORD-1006", PurchaseDate: "2026-08-10", DaysSincePurchase: 24, WithinWindow: true},
	"ORD-1007": {OrderID: "ORD-1007", PurchaseDate: "2026-08-05", DaysSincePurchase: 29, WithinWindow: true},
}

// ErrOrderNotFound means the given order ID has no return-eligibility record.
type ErrOrderNotFound struct {
	OrderID string
}

func (e *ErrOrderNotFound) Error() string {
	return fmt.Sprintf("no return-eligibility record for order %q", e.OrderID)
}

// returnWindowFor returns the return-eligibility record for orderID, or
// ErrOrderNotFound if none exists.
func returnWindowFor(orderID string) (ReturnWindowRecord, error) {
	rec, ok := mockReturnWindows[orderID]
	if !ok {
		return ReturnWindowRecord{}, &ErrOrderNotFound{OrderID: orderID}
	}
	return rec, nil
}
