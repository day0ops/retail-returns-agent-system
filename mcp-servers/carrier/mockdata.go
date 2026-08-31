package main

import "fmt"

// carrierByOrder maps an order to the carrier it ships with -- the same
// order/carrier pairings shipping-mcp's own mock data uses, kept as an
// independent copy here rather than a shared import: this is a genuinely
// separate service, not a shared library between the two.
var carrierByOrder = map[string]string{
	"ORD-1001": "FastShip",
	"ORD-1002": "FastShip",
	"ORD-1003": "ParcelPro",
	"ORD-1004": "FastShip",
	"ORD-1005": "ParcelPro",
	"ORD-1006": "ParcelPro",
	"ORD-1009": "FastShip",
}

// ErrOrderNotFound is returned by carrierForOrder when the given order ID has
// no associated carrier.
type ErrOrderNotFound struct {
	OrderID string
}

func (e *ErrOrderNotFound) Error() string {
	return fmt.Sprintf("no order found for %q", e.OrderID)
}

// carrierForOrder returns the carrier an order ships with, or
// ErrOrderNotFound if the order is unknown.
func carrierForOrder(orderID string) (string, error) {
	carrier, ok := carrierByOrder[orderID]
	if !ok {
		return "", &ErrOrderNotFound{OrderID: orderID}
	}
	return carrier, nil
}
