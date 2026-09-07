package main

import "fmt"

// Order is a single retail order record from the order-db mock backend.
// CustomerEmail/CustomerPhone are synthetic PII the mcp.guardrails CheckResponse
// processor redacts before the caller sees them (Stage 5, PII masking).
type Order struct {
	OrderID       string  `json:"order_id" jsonschema:"the order's unique identifier"`
	CustomerID    string  `json:"customer_id" jsonschema:"the customer who placed the order"`
	CustomerEmail string  `json:"customer_email" jsonschema:"the customer's email on file"`
	CustomerPhone string  `json:"customer_phone" jsonschema:"the customer's phone number on file"`
	Item          string  `json:"item" jsonschema:"the item name"`
	Amount        float64 `json:"amount" jsonschema:"the order total, in USD"`
	Status        string  `json:"status" jsonschema:"the order status, e.g. delivered, shipped, return_requested"`
	PurchaseDate  string  `json:"purchase_date" jsonschema:"the purchase date, in YYYY-MM-DD format"`
}

// mockOrders is the demo seed data; there is no database behind it.
var mockOrders = []Order{
	{OrderID: "ORD-1001", CustomerID: "CUST-100", CustomerEmail: "jane.doe@example.com", CustomerPhone: "555-100-1000", Item: "Wireless Headphones", Amount: 89.99, Status: "delivered", PurchaseDate: "2026-07-02"},
	{OrderID: "ORD-1002", CustomerID: "CUST-100", CustomerEmail: "jane.doe@example.com", CustomerPhone: "555-100-1000", Item: "USB-C Charging Cable", Amount: 12.50, Status: "delivered", PurchaseDate: "2026-07-15"},
	{OrderID: "ORD-1003", CustomerID: "CUST-101", CustomerEmail: "alice.wong@example.com", CustomerPhone: "555-100-1001", Item: "Standing Desk", Amount: 349.00, Status: "shipped", PurchaseDate: "2026-08-01"},
	{OrderID: "ORD-1004", CustomerID: "CUST-102", CustomerEmail: "robert.smith@example.com", CustomerPhone: "555-100-1002", Item: "Mechanical Keyboard", Amount: 129.99, Status: "return_requested", PurchaseDate: "2026-07-20"},
	{OrderID: "ORD-1005", CustomerID: "CUST-103", CustomerEmail: "maria.garcia@example.com", CustomerPhone: "555-100-1003", Item: "4K Monitor", Amount: 399.00, Status: "delivered", PurchaseDate: "2026-06-28"},
	{OrderID: "ORD-1006", CustomerID: "CUST-101", CustomerEmail: "alice.wong@example.com", CustomerPhone: "555-100-1001", Item: "Laptop Stand", Amount: 45.00, Status: "delivered", PurchaseDate: "2026-08-10"},
	{OrderID: "ORD-1007", CustomerID: "CUST-104", CustomerEmail: "sam.lee@example.com", CustomerPhone: "555-100-1004", Item: "Noise Cancelling Earbuds", Amount: 159.99, Status: "return_requested", PurchaseDate: "2026-08-05"},
	{OrderID: "ORD-1008", CustomerID: "CUST-102", CustomerEmail: "robert.smith@example.com", CustomerPhone: "555-100-1002", Item: "Webcam", Amount: 59.99, Status: "cancelled", PurchaseDate: "2026-07-11"},
	{OrderID: "ORD-1009", CustomerID: "CUST-100", CustomerEmail: "jane.doe@example.com", CustomerPhone: "555-100-1000", Item: "Home Theater Projector", Amount: 649.99, Status: "delivered", PurchaseDate: "2026-07-25"},
}

// ErrOrderNotFound means the requested order ID has no matching record.
type ErrOrderNotFound struct {
	OrderID string
}

func (e *ErrOrderNotFound) Error() string {
	return fmt.Sprintf("order %q not found", e.OrderID)
}

// listOrdersByCustomer returns the given customer's orders; an empty customerID returns all.
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

// getOrderByID returns the order matching orderID, or ErrOrderNotFound.
func getOrderByID(orderID string) (Order, error) {
	for _, o := range mockOrders {
		if o.OrderID == orderID {
			return o, nil
		}
	}
	return Order{}, &ErrOrderNotFound{OrderID: orderID}
}
