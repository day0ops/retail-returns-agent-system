package main

import "fmt"

// PaymentMethod is a customer's on-file payment method.
type PaymentMethod struct {
	CustomerID string `json:"customer_id" jsonschema:"the customer who owns this payment method"`
	Type       string `json:"type" jsonschema:"the payment method type, e.g. credit_card, paypal"`
	Last4      string `json:"last4" jsonschema:"the last 4 digits of the card or account, for display"`
}

// RefundResult is the outcome of a refund_payment call.
type RefundResult struct {
	OrderID string  `json:"order_id" jsonschema:"the order the refund was issued for"`
	Amount  float64 `json:"amount" jsonschema:"the refunded amount, in USD"`
	Status  string  `json:"status" jsonschema:"the refund status, e.g. refunded"`
}

// mockPaymentMethods is the hardcoded seed data for this demo. There is no
// real payment processor behind this; it exists only to give the guided-tour
// agents something real to look up and act on.
var mockPaymentMethods = []PaymentMethod{
	{CustomerID: "CUST-100", Type: "credit_card", Last4: "4242"},
	{CustomerID: "CUST-101", Type: "paypal", Last4: "n/a"},
	{CustomerID: "CUST-102", Type: "credit_card", Last4: "1881"},
	{CustomerID: "CUST-103", Type: "credit_card", Last4: "0005"},
	{CustomerID: "CUST-104", Type: "debit_card", Last4: "9999"},
}

// ErrPaymentMethodNotFound is returned by getPaymentMethod when the given
// customer ID has no payment method on file.
type ErrPaymentMethodNotFound struct {
	CustomerID string
}

func (e *ErrPaymentMethodNotFound) Error() string {
	return fmt.Sprintf("no payment method on file for customer %q", e.CustomerID)
}

// getPaymentMethod returns the payment method on file for customerID, or
// ErrPaymentMethodNotFound if none exists.
func getPaymentMethod(customerID string) (PaymentMethod, error) {
	for _, m := range mockPaymentMethods {
		if m.CustomerID == customerID {
			return m, nil
		}
	}
	return PaymentMethod{}, &ErrPaymentMethodNotFound{CustomerID: customerID}
}

// refundPayment simulates issuing a refund. There is no real ledger behind
// this; it always succeeds for a non-empty order ID and positive amount.
func refundPayment(orderID string, amount float64) (RefundResult, error) {
	if orderID == "" {
		return RefundResult{}, fmt.Errorf("order_id must not be empty")
	}
	if amount <= 0 {
		return RefundResult{}, fmt.Errorf("amount must be positive, got %v", amount)
	}
	return RefundResult{OrderID: orderID, Amount: amount, Status: "refunded"}, nil
}
