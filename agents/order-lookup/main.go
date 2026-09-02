// Command order-lookup is a kagent BYO agent, built on kagent's Go ADK
// (github.com/kagent-dev/kagent/go/adk), that looks up a customer's order
// and its shipment status via the order-db and shipping MCP servers.
package main

import (
	"context"
	"log"
	"os"
	"time"

	a2atype "github.com/a2aproject/a2a-go/v2/a2a"
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

	shutdownTelemetry, telemetryEnabled, err := kagenttelemetry.Init(ctx, "order-lookup", envOr("KAGENT_NAMESPACE", "kagent"))
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

	// Wire order-db and shipping as tool sources. *_URL point at k8s Service
	// DNS once deployed (a later phase's usecase spec), or localhost for
	// local dev.
	toolsets := adkmcp.CreateToolsets(ctx, []adk.HttpMcpServerConfig{
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("ORDER_DB_URL", "http://localhost:8080/mcp")}},
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("SHIPPING_URL", "http://localhost:8081/mcp")}},
	}, nil /* no SSE servers */, nil /* no stdio servers */, true /* propagateToken: forward the customer JWT to MCP calls */, nil /* headerProvider */)

	// Next hop of the A2A chain: hand off to fraud_check once order/shipment
	// details are confirmed. propagateToken: true forwards the customer's JWT
	// on this outbound A2A call the same way it's forwarded to the MCP calls above.
	// isolateSessions: true -- see support-triage/main.go's order_lookup tool for
	// why (confirmed live: without it, this hop's sub-agent session accumulates
	// across every unrelated request for this pod's whole lifetime).
	fraudCheckTool, err := adktools.NewKAgentRemoteA2ATool(
		"fraud_check",
		"Delegates transaction fraud risk scoring to the fraud-check agent",
		envOr("FRAUD_CHECK_AGENT_URL", "http://localhost:8082"),
		nil, nil, true, true,
	)
	if err != nil {
		log.Fatalf("Failed to create fraud_check A2A tool: %v", err)
	}

	orderLookup, err := llmagent.New(llmagent.Config{
		Name:        "order_lookup",
		Description: "Looks up a customer's order and its shipment status",
		Instruction: "You are a retail order lookup agent. Given an order ID, " +
			"use the order-db tools to fetch the order and the shipping tools " +
			"to fetch its shipment status. Once confirmed, delegate to the " +
			"fraud_check agent to continue the return chain. Your request to fraud_check " +
			"MUST state the order's exact dollar amount, order ID, and customer ID as " +
			"returned by the order-db tool -- never paraphrase, round, or omit them, since " +
			"refund_approval at the end of the chain needs the exact figure to decide whether " +
			"to ask the customer a follow-up question, and needs the customer ID to look up " +
			"their payment method and loyalty account. Summarize the outcome.",
		Model:    llmModel,
		Toolsets: toolsets,
		Tools:    []adktool.Tool{fraudCheckTool},
	})
	if err != nil {
		log.Fatalf("Failed to create order_lookup agent: %v", err)
	}

	runnerConfig := runner.Config{
		AppName:        "order-lookup",
		Agent:          orderLookup,
		SessionService: adksession.InMemoryService(),
	}
	executor := kagenta2a.NewKAgentExecutor(kagenta2a.KAgentExecutorConfig{
		RunnerConfig: runnerConfig,
		Stream:       true,
		AppName:      "order-lookup",
		Logger:       logger,
	})

	kagentApp, err := app.New(app.AppConfig{
		AgentCard: a2atype.AgentCard{
			Name:        "order-lookup",
			Description: "Retail order lookup agent -- fetches order and shipment details",
			Version:     "0.1.0",
			Capabilities: a2atype.AgentCapabilities{
				Streaming: true,
			},
			DefaultInputModes:  []string{"text/plain"},
			DefaultOutputModes: []string{"text/plain"},
			Skills: []a2atype.AgentSkill{
				{ID: "lookup-order", Name: "Lookup Order", Description: "Look up an order and its shipment status"},
			},
		},
		Port:   envOr("PORT", "8080"),
		Logger: logger,
		Agent:  orderLookup,
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
