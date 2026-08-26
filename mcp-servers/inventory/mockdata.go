package main

// StockLevel is the current stock count for an item.
type StockLevel struct {
	Item      string `json:"item" jsonschema:"the item name"`
	Available int    `json:"available" jsonschema:"units currently available in stock"`
}

// mockStock is the hardcoded seed data for this demo. There is no real
// warehouse system behind this; it exists only to give the guided-tour
// agents something real to look up. Items not present here are treated as
// out of stock (0 available) rather than an error, matching how a real
// inventory lookup would behave for an unknown SKU.
var mockStock = map[string]int{
	"Wireless Headphones":      12,
	"USB-C Charging Cable":     340,
	"Standing Desk":            3,
	"Mechanical Keyboard":      0,
	"4K Monitor":               7,
	"Laptop Stand":             54,
	"Noise Cancelling Earbuds": 0,
	"Webcam":                   21,
}

// checkStock returns the current stock level for item. Unknown items are
// reported as zero available, not an error.
func checkStock(item string) StockLevel {
	return StockLevel{Item: item, Available: mockStock[item]}
}
