package main

import "fmt"

// Order is a single retail order record served by the order-db mock backend.
type Order struct {
	OrderID      string  `json:"order_id" jsonschema:"the order's unique identifier"`
	CustomerID   string  `json:"customer_id" jsonschema:"the customer who placed the order"`
	Item         string  `json:"item" jsonschema:"the item name"`
	Amount       float64 `json:"amount" jsonschema:"the order total, in USD"`
	Status       string  `json:"status" jsonschema:"the order status, e.g. delivered, shipped, return_requested"`
	PurchaseDate string  `json:"purchase_date" jsonschema:"the purchase date, in YYYY-MM-DD format"`
}

// mockOrders is the hardcoded seed data for this demo. There is no database
// backing this; it exists only to give the guided-tour agents something
// real to look up.
var mockOrders = []Order{
	{OrderID: "ORD-1001", CustomerID: "CUST-100", Item: "Wireless Headphones", Amount: 89.99, Status: "delivered", PurchaseDate: "2026-07-02"},
	{OrderID: "ORD-1002", CustomerID: "CUST-100", Item: "USB-C Charging Cable", Amount: 12.50, Status: "delivered", PurchaseDate: "2026-07-15"},
	{OrderID: "ORD-1003", CustomerID: "CUST-101", Item: "Standing Desk", Amount: 349.00, Status: "shipped", PurchaseDate: "2026-08-01"},
	{OrderID: "ORD-1004", CustomerID: "CUST-102", Item: "Mechanical Keyboard", Amount: 129.99, Status: "return_requested", PurchaseDate: "2026-07-20"},
	{OrderID: "ORD-1005", CustomerID: "CUST-103", Item: "4K Monitor", Amount: 399.00, Status: "delivered", PurchaseDate: "2026-06-28"},
	{OrderID: "ORD-1006", CustomerID: "CUST-101", Item: "Laptop Stand", Amount: 45.00, Status: "delivered", PurchaseDate: "2026-08-10"},
	{OrderID: "ORD-1007", CustomerID: "CUST-104", Item: "Noise Cancelling Earbuds", Amount: 159.99, Status: "return_requested", PurchaseDate: "2026-08-05"},
	{OrderID: "ORD-1008", CustomerID: "CUST-102", Item: "Webcam", Amount: 59.99, Status: "cancelled", PurchaseDate: "2026-07-11"},
}

// ErrOrderNotFound is returned by getOrder when the requested order ID has
// no matching record.
type ErrOrderNotFound struct {
	OrderID string
}

func (e *ErrOrderNotFound) Error() string {
	return fmt.Sprintf("order %q not found", e.OrderID)
}

// listOrdersByCustomer returns every order placed by the given customer ID,
// in seed-data order. An empty customerID returns every order.
func listOrdersByCustomer(customerID string) []Order {
	if customerID == "" {
		return mockOrders
	}
	var result []Order
	for _, o := range mockOrders {
		if o.CustomerID == customerID {
			result = append(result, o)
		}
	}
	return result
}

// getOrderByID returns the order matching orderID, or ErrOrderNotFound if no
// such order exists.
func getOrderByID(orderID string) (Order, error) {
	for _, o := range mockOrders {
		if o.OrderID == orderID {
			return o, nil
		}
	}
	return Order{}, &ErrOrderNotFound{OrderID: orderID}
}
