// Command access-policy-test-harness is a tiny HTTP service that calls a
// named MCP tool on returns-eligibility using whichever Kubernetes
// ServiceAccount its own Deployment is configured with. Deployed twice under
// two different existing agent ServiceAccounts (Stage 11) so the guided tour
// can prove kagent's AccessPolicy really discriminates by caller identity,
// without touching any real agent's production code.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type callToolRequest struct {
	Tool string         `json:"tool"`
	Args map[string]any `json:"args"`
}

type callToolResponse struct {
	Identity string `json:"identity"`
	Allowed  bool   `json:"allowed"`
	Result   any    `json:"result,omitempty"`
	Error    string `json:"error,omitempty"`
}

func callTool(ctx context.Context, targetURL, tool string, args map[string]any) (any, error) {
	client := mcp.NewClient(&mcp.Implementation{Name: "access-policy-test-harness", Version: "0.1.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: targetURL}, nil)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	defer func() { _ = session.Close() }()

	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		// A denied call surfaces here as a JSON-RPC error (e.g. "Unknown tool"),
		// not a successful result -- see mcp/main.go's AccessPolicy denial.
		return nil, err
	}
	return result.StructuredContent, nil
}

func main() {
	identity := envOr("IDENTITY", "unknown")
	targetURL := os.Getenv("RETURNS_ELIGIBILITY_URL")
	if targetURL == "" {
		log.Fatal("RETURNS_ELIGIBILITY_URL is required")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/call-tool", func(w http.ResponseWriter, r *http.Request) {
		var req callToolRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		resp := callToolResponse{Identity: identity}
		result, err := callTool(r.Context(), targetURL, req.Tool, req.Args)
		if err != nil {
			resp.Error = err.Error()
		} else {
			resp.Allowed = true
			resp.Result = result
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})

	addr := ":" + envOr("PORT", "8080")
	log.Printf("access-policy-test-harness (identity=%s) listening on %s", identity, addr)
	if err := http.ListenAndServe(addr, mux); err != nil { //nolint:gosec // demo harness, no need for custom timeouts
		log.Fatalf("server error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
