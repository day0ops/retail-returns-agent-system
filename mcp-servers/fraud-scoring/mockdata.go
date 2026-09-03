package main

// RiskScore is a mock fraud risk assessment for an order.
type RiskScore struct {
	OrderID string  `json:"order_id" jsonschema:"the order that was scored"`
	Score   float64 `json:"score" jsonschema:"a risk score between 0 (no risk) and 1 (high risk)"`
	Level   string  `json:"level" jsonschema:"a human-readable risk level, e.g. low, medium, high"`
}

// mockRiskScores is the demo seed data; no real fraud model behind it. Orders
// not listed default to low risk, not an error, like a real engine scoring a
// transaction it has no history on.
var mockRiskScores = map[string]float64{
	"ORD-1001": 0.05,
	"ORD-1002": 0.02,
	"ORD-1003": 0.10,
	"ORD-1004": 0.72,
	"ORD-1005": 0.08,
	"ORD-1006": 0.03,
	"ORD-1007": 0.85,
	"ORD-1008": 0.40,
}

// riskLevel buckets a numeric score into a human-readable level.
func riskLevel(score float64) string {
	switch {
	case score >= 0.7:
		return "high"
	case score >= 0.3:
		return "medium"
	default:
		return "low"
	}
}

// scoreTransaction returns a mock risk score for orderID; unknown orders default to 0, not an error.
func scoreTransaction(orderID string) RiskScore {
	score := mockRiskScores[orderID]
	return RiskScore{OrderID: orderID, Score: score, Level: riskLevel(score)}
}
