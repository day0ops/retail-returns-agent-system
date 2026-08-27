// Command order-lookup is a kagent BYO agent, built on kagent's Go ADK
// (github.com/kagent-dev/kagent/go/adk), that looks up a customer's order
// and its shipment status via the order-db and shipping MCP servers.
package main

import (
	"context"
	"log"
	"os"

	a2atype "github.com/a2aproject/a2a-go/a2a"
	"github.com/go-logr/logr"
	"github.com/go-logr/zapr"
	"github.com/kagent-dev/kagent/go/adk/pkg/app"
	adkmcp "github.com/kagent-dev/kagent/go/adk/pkg/mcp"
	"github.com/kagent-dev/kagent/go/adk/pkg/models"
	"github.com/kagent-dev/kagent/go/api/adk"
	"go.uber.org/zap"
	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/adk/v2/server/adka2a" //nolint:staticcheck // kagent still uses a2a-go v1; this ADK package is the compatibility adapter.
	adksession "google.golang.org/adk/v2/session"
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
	}, nil /* no SSE servers */, true /* propagateToken: forward the customer JWT to MCP calls */, nil /* headerProvider */)

	orderLookup, err := llmagent.New(llmagent.Config{
		Name:        "order_lookup",
		Description: "Looks up a customer's order and its shipment status",
		Instruction: "You are a retail order lookup agent. Given an order ID, " +
			"use the order-db tools to fetch the order and the shipping tools " +
			"to fetch its shipment status. Summarize both for the caller.",
		Model:    llmModel,
		Toolsets: toolsets,
	})
	if err != nil {
		log.Fatalf("Failed to create order_lookup agent: %v", err)
	}

	runnerConfig := runner.Config{
		AppName:        "order-lookup",
		Agent:          orderLookup,
		SessionService: adksession.InMemoryService(),
	}
	var runConfig adkagent.RunConfig
	runConfig.StreamingMode = adkagent.StreamingModeSSE
	executor := adka2a.NewExecutor(adka2a.ExecutorConfig{RunnerConfig: runnerConfig, RunConfig: runConfig})

	kagentApp, err := app.New(app.AppConfig{
		AgentCard: a2atype.AgentCard{
			Name:        "order-lookup",
			Description: "Retail order lookup agent -- fetches order and shipment details",
			Version:     "0.1.0",
			URL:         envOr("AGENT_CARD_URL", "http://localhost:8080"),
			Capabilities: a2atype.AgentCapabilities{
				Streaming:              true,
				StateTransitionHistory: true,
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
