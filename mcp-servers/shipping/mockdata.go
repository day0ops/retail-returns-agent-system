package main

import "fmt"

// Shipment is a single shipment record, keyed by the order it belongs to.
type Shipment struct {
	OrderID        string `json:"order_id" jsonschema:"the order this shipment belongs to"`
	Carrier        string `json:"carrier" jsonschema:"the shipping carrier"`
	TrackingNumber string `json:"tracking_number" jsonschema:"the carrier tracking number"`
	Status         string `json:"status" jsonschema:"the shipment status, e.g. in_transit, delivered"`
}

// mockShipments is the hardcoded seed data for this demo. There is no real
// carrier integration behind this; it exists only to give the guided-tour
// agents something real to look up.
var mockShipments = []Shipment{
	{OrderID: "ORD-1001", Carrier: "FastShip", TrackingNumber: "FS100100", Status: "delivered"},
	{OrderID: "ORD-1002", Carrier: "FastShip", TrackingNumber: "FS100200", Status: "delivered"},
	{OrderID: "ORD-1003", Carrier: "ParcelPro", TrackingNumber: "PP100300", Status: "in_transit"},
	{OrderID: "ORD-1004", Carrier: "FastShip", TrackingNumber: "FS100400", Status: "delivered"},
	{OrderID: "ORD-1005", Carrier: "ParcelPro", TrackingNumber: "PP100500", Status: "delivered"},
	{OrderID: "ORD-1006", Carrier: "ParcelPro", TrackingNumber: "PP100600", Status: "delivered"},
	{OrderID: "ORD-1009", Carrier: "FastShip", TrackingNumber: "FS100900", Status: "delivered"},
}

// ErrShipmentNotFound is returned by getShipmentStatus when the given order
// ID has no associated shipment.
type ErrShipmentNotFound struct {
	OrderID string
}

func (e *ErrShipmentNotFound) Error() string {
	return fmt.Sprintf("no shipment found for order %q", e.OrderID)
}

// getShipmentStatus returns the shipment record for orderID, or
// ErrShipmentNotFound if none exists.
func getShipmentStatus(orderID string) (Shipment, error) {
	for _, s := range mockShipments {
		if s.OrderID == orderID {
			return s, nil
		}
	}
	return Shipment{}, &ErrShipmentNotFound{OrderID: orderID}
}
