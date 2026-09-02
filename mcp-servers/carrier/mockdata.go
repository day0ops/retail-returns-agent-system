package main

import "fmt"

// carrierByOrder maps an order to its carrier. Mirrors shipping-mcp's pairings but
// keeps an independent copy on purpose: this is a separate service, not a shared library.
var carrierByOrder = map[string]string{
	"ORD-1001": "FastShip",
	"ORD-1002": "FastShip",
	"ORD-1003": "ParcelPro",
	"ORD-1004": "FastShip",
	"ORD-1005": "ParcelPro",
	"ORD-1006": "ParcelPro",
	"ORD-1009": "FastShip",
}

// ErrOrderNotFound means the order ID has no associated carrier.
type ErrOrderNotFound struct {
	OrderID string
}

func (e *ErrOrderNotFound) Error() string {
	return fmt.Sprintf("no order found for %q", e.OrderID)
}

// carrierForOrder returns the order's carrier, or ErrOrderNotFound if unknown.
func carrierForOrder(orderID string) (string, error) {
	carrier, ok := carrierByOrder[orderID]
	if !ok {
		return "", &ErrOrderNotFound{OrderID: orderID}
	}
	return carrier, nil
}
