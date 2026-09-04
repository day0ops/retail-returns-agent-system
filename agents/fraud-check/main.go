// Command fraud-check is a kagent BYO agent that scores an order's fraud risk
// via the fraud-scoring MCP server.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	a2atype "github.com/a2aproject/a2a-go/v2/a2a"
	"github.com/a2aproject/a2a-go/v2/a2asrv"
	"github.com/go-logr/logr"
	"github.com/go-logr/zapr"
	kagenta2a "github.com/kagent-dev/kagent/go/adk/pkg/a2a"
	"github.com/kagent-dev/kagent/go/adk/pkg/app"
	adkmcp "github.com/kagent-dev/kagent/go/adk/pkg/mcp"
	"github.com/kagent-dev/kagent/go/adk/pkg/models"
	kagenttelemetry "github.com/kagent-dev/kagent/go/adk/pkg/telemetry"
	adktools "github.com/kagent-dev/kagent/go/adk/pkg/tools"
	"github.com/kagent-dev/kagent/go/api/adk"
	"go.uber.org/zap"
	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/runner"
	adksession "google.golang.org/adk/v2/session"
	adktool "google.golang.org/adk/v2/tool"
	"google.golang.org/adk/v2/tool/functiontool"
)

// WhoamiOutput mirrors order-db-mcp's own whoami tool (mcp-servers/order-db/main.go)
// -- same diagnostic idea, ported to an A2A agent's inbound call context instead of
// an MCP server's HTTP request.
type WhoamiOutput struct {
	AuthorizationPresent bool           `json:"authorization_present" jsonschema:"whether an Authorization header was received on this A2A call"`
	Claims               map[string]any `json:"claims,omitempty" jsonschema:"decoded (unverified) JWT claims from the received token, if present and well-formed"`
}

// whoamiHandler decodes the claims of the bearer token this agent actually
// received on the current A2A call, to prove agentgateway's delegation
// exchange populated a real `act` claim (RFC 8693 delegation prototype).
// No signature verification -- display aid, not an auth check.
//
// a2asrv.CallContextFrom(ctx) reads the SAME inbound call metadata that
// authzForwardingInterceptor (kagent SDK's remote_a2a_tool.go) already
// forwards onward to the next A2A hop -- this just reads it instead of
// relaying it.
func whoamiHandler(ctx adkagent.Context, _ struct{}) (WhoamiOutput, error) {
	callCtx, ok := a2asrv.CallContextFrom(ctx)
	if !ok {
		return WhoamiOutput{}, nil
	}
	authHeader, ok := callCtx.ServiceParams().Get("authorization")
	if !ok || len(authHeader) == 0 || authHeader[0] == "" {
		return WhoamiOutput{}, nil
	}
	claims, err := decodeJWTClaims(authHeader[0])
	if err != nil {
		// Malformed token: report it arrived, but with no claims.
		return WhoamiOutput{AuthorizationPresent: true}, nil
	}
	return WhoamiOutput{AuthorizationPresent: true, Claims: claims}, nil
}

// decodeJWTClaims base64url-decodes a JWT payload as JSON. It does not verify
// the signature; the result is a display value, not authenticated identity.
func decodeJWTClaims(authHeader string) (map[string]any, error) {
	token := strings.TrimPrefix(authHeader, "Bearer ")
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("not a JWT: expected 3 dot-separated parts, got %d", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decoding JWT payload: %w", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("parsing JWT claims: %w", err)
	}
	return claims, nil
}

func main() {
	zapLogger, _ := zap.NewProduction()
	defer func() { _ = zapLogger.Sync() }()
	logger := zapr.NewLogger(zapLogger)
	ctx := logr.NewContext(context.Background(), logger)

	shutdownTelemetry, telemetryEnabled, err := kagenttelemetry.Init(ctx, "fraud-check", envOr("KAGENT_NAMESPACE", "kagent"))
	if err != nil {
		logger.Error(err, "telemetry setup failed; continuing without tracing")
	} else if telemetryEnabled {
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := shutdownTelemetry(shutdownCtx); err != nil {
				logger.Error(err, "telemetry shutdown failed")
			}
		}()
	}

	// LLM calls route through the hub agentgateway's OpenAI-compatible path
	// (<gateway>/openai/v1) for cost tracking and telemetry. Empty LLM_BASE_URL
	// falls back to the OpenAI SDK default (openai.com) for local dev.
	llmModel, err := models.NewOpenAIModelWithLogger(&models.OpenAIConfig{
		Model:   envOr("MODEL_NAME", "gpt-4o-mini"),
		BaseUrl: os.Getenv("LLM_BASE_URL"),
		// Reasoning models (e.g. gpt-5.6) reject function tools over
		// /v1/chat/completions unless reasoning_effort is "none"; standard models
		// may reject the param, so it stays nil unless MODEL_REASONING_EFFORT is set.
		ReasoningEffort: envPtr("MODEL_REASONING_EFFORT"),
	}, logger)
	if err != nil {
		log.Fatalf("Failed to create LLM model: %v", err)
	}

	// FRAUD_SCORING_URL points at the k8s Service once deployed, or localhost:8080
	// for local dev.
	toolsets := adkmcp.CreateToolsets(ctx, []adk.HttpMcpServerConfig{
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("FRAUD_SCORING_URL", "http://localhost:8080/mcp")}},
	}, nil /* no SSE servers */, nil /* no stdio servers */, true /* propagateToken: forward the customer JWT to MCP calls */, nil /* headerProvider */)

	// Hands off to refund_approval once risk is scored. propagateToken forwards
	// the customer JWT; isolateSessions (see support-triage order_lookup) prevents
	// the shared-session bug that surfaced live here: refund_approval's accumulated
	// history (10+ prior refunds in one "conversation") made its LLM treat a fresh
	// return as already handled, silently skipping the loyalty-points award.
	refundApprovalTool, err := adktools.NewKAgentRemoteA2ATool(
		"refund_approval",
		"Delegates payment method lookup and refund processing to the refund-approval agent",
		envOr("REFUND_APPROVAL_AGENT_URL", "http://localhost:8083"),
		nil, nil, true, true,
	)
	if err != nil {
		log.Fatalf("Failed to create refund_approval A2A tool: %v", err)
	}

	whoamiTool, err := functiontool.New(functiontool.Config{
		Name:        "whoami",
		Description: "Diagnostic: decode the Authorization header this agent actually received on this A2A call, to prove token delegation happened",
	}, whoamiHandler)
	if err != nil {
		log.Fatalf("Failed to create whoami tool: %v", err)
	}

	fraudCheck, err := llmagent.New(llmagent.Config{
		Name:        "fraud_check",
		Description: "Scores an order's fraud risk before a refund is approved",
		Instruction: "You are a fraud review agent. Given an order ID, " +
			"use the fraud-scoring tools to assess its risk and report the " +
			"score and risk level. Once assessed, delegate to the refund_approval " +
			"agent to conclude the return chain. Your request to refund_approval MUST " +
			"state the order's exact dollar amount, order ID, and customer ID exactly as " +
			"you received them -- never paraphrase, round, or omit them, since " +
			"refund_approval needs the exact figure to decide whether to ask the customer " +
			"a follow-up question, and needs the customer ID to look up their payment " +
			"method and loyalty account. Summarize the final outcome.",
		Model:    llmModel,
		Toolsets: toolsets,
		Tools:    []adktool.Tool{refundApprovalTool, whoamiTool},
	})
	if err != nil {
		log.Fatalf("Failed to create fraud_check agent: %v", err)
	}

	runnerConfig := runner.Config{
		AppName:        "fraud-check",
		Agent:          fraudCheck,
		SessionService: adksession.InMemoryService(),
	}
	executor := kagenta2a.NewKAgentExecutor(kagenta2a.KAgentExecutorConfig{
		RunnerConfig: runnerConfig,
		Stream:       true,
		AppName:      "fraud-check",
		Logger:       logger,
	})

	kagentApp, err := app.New(app.AppConfig{
		AgentCard: a2atype.AgentCard{
			Name:        "fraud-check",
			Description: "Retail fraud check agent -- scores an order's fraud risk",
			Version:     "0.1.0",
			Capabilities: a2atype.AgentCapabilities{
				Streaming: true,
			},
			DefaultInputModes:  []string{"text/plain"},
			DefaultOutputModes: []string{"text/plain"},
			Skills: []a2atype.AgentSkill{
				{ID: "score-fraud-risk", Name: "Score Fraud Risk", Description: "Assess an order's fraud risk"},
			},
			// See support-triage/main.go's AgentCard for why this is required.
			SupportedInterfaces: []*a2atype.AgentInterface{
				a2atype.NewAgentInterface(envOr("AGENT_CARD_URL", "http://localhost:"+envOr("PORT", "8080")), a2atype.TransportProtocolJSONRPC),
			},
		},
		Port:   envOr("PORT", "8080"),
		Logger: logger,
		Agent:  fraudCheck,
	}, executor)
	if err != nil {
		log.Fatalf("Failed to create app: %v", err)
	}
	if err := kagentApp.Run(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envPtr returns a pointer to the env var's value, or nil if unset. Unlike
// envOr, an unset value stays nil (omitted from the request) rather than
// falling back to a default.
func envPtr(key string) *string {
	if v := os.Getenv(key); v != "" {
		return &v
	}
	return nil
}
