// Command support-triage is the first hop in the retail returns copilot's
// agent chain. It is a kagent BYO agent, built on kagent's Go ADK
// (github.com/kagent-dev/kagent/go/adk), that looks up a customer's order
// via the order-db MCP server and summarizes it.
package main

import (
	"context"
	"log"
	"os"

	a2atype "github.com/a2aproject/a2a-go/v2/a2a"
	"github.com/go-logr/logr"
	"github.com/go-logr/zapr"
	kagenta2a "github.com/kagent-dev/kagent/go/adk/pkg/a2a"
	"github.com/kagent-dev/kagent/go/adk/pkg/app"
	adkmcp "github.com/kagent-dev/kagent/go/adk/pkg/mcp"
	"github.com/kagent-dev/kagent/go/adk/pkg/models"
	adktools "github.com/kagent-dev/kagent/go/adk/pkg/tools"
	"github.com/kagent-dev/kagent/go/api/adk"
	"go.uber.org/zap"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/runner"
	adksession "google.golang.org/adk/v2/session"
	adktool "google.golang.org/adk/v2/tool"
)

func main() {
	zapLogger, _ := zap.NewProduction()
	defer func() { _ = zapLogger.Sync() }()
	logger := zapr.NewLogger(zapLogger)
	ctx := logr.NewContext(context.Background(), logger)

	// LLM calls go through the hub agentgateway's OpenAI-compatible route
	// (matching finflow's LLM_BASE_URL convention: <gateway>/openai/v1) rather
	// than hitting OpenAI directly, for cost tracking and telemetry. Empty
	// LLM_BASE_URL falls back to the OpenAI SDK's default (openai.com), which
	// is what local dev without a deployed gateway uses.
	llmModel, err := models.NewOpenAIModelWithLogger(&models.OpenAIConfig{
		Model:   envOr("MODEL_NAME", "gpt-4o-mini"),
		BaseUrl: os.Getenv("LLM_BASE_URL"),
		// Reasoning-class models (e.g. gpt-5.6) reject function tools over
		// /v1/chat/completions unless reasoning_effort is explicitly "none";
		// standard models neither need nor necessarily accept the param, so it
		// must stay unset (nil) unless a reasoning model is actually configured
		// (see MODEL_REASONING_EFFORT in the app manifest).
		ReasoningEffort: envPtr("MODEL_REASONING_EFFORT"),
	}, logger)
	if err != nil {
		log.Fatalf("Failed to create LLM model: %v", err)
	}

	// Wire order-db as a tool source. ORDER_DB_URL points at the k8s Service
	// once deployed (a later phase's usecase spec), or localhost:8080 for
	// local dev.
	toolsets := adkmcp.CreateToolsets(ctx, []adk.HttpMcpServerConfig{
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("ORDER_DB_URL", "http://localhost:8080/mcp")}},
	}, nil /* no SSE servers */, nil /* no stdio servers */, true /* propagateToken: forward the customer JWT to MCP calls */, nil /* headerProvider */)

	// First hop of the A2A chain: hand off eligibility/fraud/refund work to
	// order-lookup. propagateToken: true forwards the customer's JWT on this
	// outbound A2A call the same way it's forwarded to order-db above.
	// isolateSessions: true -- each incoming customer request is an independent
	// return, not a continuation of a prior conversation. Without this, every
	// call sharing this agent's fixed process lifetime collapses into one ever-
	// growing sub-agent session (confirmed live: the same session id persisted
	// across 10+ unrelated requests spanning 43 minutes), and the downstream
	// LLM starts reasoning from stale accumulated history instead of the
	// current request -- e.g. skipping a real action because it looks, from
	// that shared history, like it was already done in an earlier "turn".
	orderLookupTool, err := adktools.NewKAgentRemoteA2ATool(
		"order_lookup",
		"Delegates order and shipment detail lookup to the order-lookup agent",
		envOr("ORDER_LOOKUP_AGENT_URL", "http://localhost:8081"),
		nil, nil, true, true,
	)
	if err != nil {
		log.Fatalf("Failed to create order_lookup A2A tool: %v", err)
	}

	supportTriage, err := llmagent.New(llmagent.Config{
		Name:        "support_triage",
		Description: "Triages a customer's return/refund request and looks up their order",
		Instruction: "If the customer's message directly names a specific tool to call (for " +
			"example, \"call the whoami diagnostic tool\"), call exactly that tool immediately " +
			"and report back exactly what it returned, verbatim -- this is a diagnostic request, " +
			"not a return request, and does not need an order ID or customer ID. " +
			"Otherwise: You are a retail support agent. Given a customer's return request, " +
			"use the order-db tools to look up their order, then delegate to the " +
			"order_lookup agent to verify shipment details and continue the return chain " +
			"(order_lookup hands off to fraud_check, which hands off to refund_approval). " +
			"Your request to order_lookup MUST state the order's exact dollar amount, order ID, " +
			"and customer ID as returned by the order-db tool -- never paraphrase, round, or " +
			"omit them, since refund_approval at the end of the chain needs the exact figure to " +
			"decide whether to ask the customer a follow-up question, and needs the customer ID " +
			"to look up their payment method and loyalty account. " +
			"Summarize the final outcome for the customer. Do not process refunds yourself.",
		Model:    llmModel,
		Toolsets: toolsets,
		Tools:    []adktool.Tool{orderLookupTool},
	})
	if err != nil {
		log.Fatalf("Failed to create support_triage agent: %v", err)
	}

	runnerConfig := runner.Config{
		AppName:        "support-triage",
		Agent:          supportTriage,
		SessionService: adksession.InMemoryService(),
	}
	executor := kagenta2a.NewKAgentExecutor(kagenta2a.KAgentExecutorConfig{
		RunnerConfig: runnerConfig,
		Stream:       true,
		AppName:      "support-triage",
		Logger:       logger,
	})

	kagentApp, err := app.New(app.AppConfig{
		AgentCard: a2atype.AgentCard{
			Name:        "support-triage",
			Description: "Retail support triage agent -- first hop in the returns copilot chain",
			Version:     "0.1.0",
			Capabilities: a2atype.AgentCapabilities{
				Streaming: true,
			},
			DefaultInputModes:  []string{"text/plain"},
			DefaultOutputModes: []string{"text/plain"},
			Skills: []a2atype.AgentSkill{
				{ID: "triage-return", Name: "Triage Return", Description: "Look up an order and summarize its return eligibility"},
			},
		},
		Port:   envOr("PORT", "8080"),
		Logger: logger,
		Agent:  supportTriage,
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

// envPtr returns a pointer to the env var's value, or nil if unset -- distinct
// from envOr's fallback-to-default since an unset ReasoningEffort must stay
// nil (omitted from the request) rather than fall back to some string value.
func envPtr(key string) *string {
	if v := os.Getenv(key); v != "" {
		return &v
	}
	return nil
}
