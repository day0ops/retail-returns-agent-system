package main

// StockLevel is the current stock count for an item.
type StockLevel struct {
	Item      string `json:"item" jsonschema:"the item name"`
	Available int    `json:"available" jsonschema:"units currently available in stock"`
}

// mockStock is the demo seed data; no real warehouse behind it. Items not listed
// are treated as out of stock (0), not an error, like a real lookup of an unknown SKU.
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

// checkStock returns the stock level for item; unknown items report 0, not an error.
func checkStock(item string) StockLevel {
	return StockLevel{Item: item, Available: mockStock[item]}
}
