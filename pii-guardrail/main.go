// Command pii-guardrail is an ExtMcp policy server (agentgateway's
// mcp.guardrails hook, modeled on Envoy ext_authz at the MCP method layer).
// It masks PII (email addresses, phone numbers) out of MCP tool results on
// the response path -- Stage 5 of the guided tour. Tool-call gating
// (CheckRequest) always passes; deny-by-tool-name is a separate concern
// (Stage 4/mcp.authorization), not this stage's job.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"os"

	"github.com/agentgateway/agentgateway/api"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type guardrailServer struct {
	api.UnimplementedExtMcpServer
}

func pass() *api.McpResponseResult {
	return &api.McpResponseResult{Result: &api.McpResponseResult_Pass{Pass: &api.Pass{}}}
}

func (s *guardrailServer) CheckRequest(_ context.Context, _ *api.McpRequest) (*api.McpRequestResult, error) {
	return &api.McpRequestResult{Result: &api.McpRequestResult_Pass{Pass: &api.Pass{}}}, nil
}

func (s *guardrailServer) CheckResponse(_ context.Context, req *api.McpResponse) (*api.McpResponseResult, error) {
	raw := req.GetMcpResponse()
	if len(raw) == 0 {
		return pass(), nil
	}

	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, status.Errorf(codes.Internal, "pii-guardrail: parsing mcp_response: %v", err)
	}

	redacted, changed := redactValue(parsed)
	if !changed {
		return pass(), nil
	}

	out, err := json.Marshal(redacted)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "pii-guardrail: marshaling redacted response: %v", err)
	}
	return &api.McpResponseResult{Result: &api.McpResponseResult_Mutated{Mutated: out}}, nil
}

func main() {
	port := envOr("PORT", "4445")
	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("listen on :%s: %v", port, err)
	}

	grpcServer := grpc.NewServer()
	api.RegisterExtMcpServer(grpcServer, &guardrailServer{})

	log.Printf("pii-guardrail ExtMcp server listening on :%s (plaintext grpc/h2c)", port)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
