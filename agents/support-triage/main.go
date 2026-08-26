// Command support-triage is the first hop in the retail returns copilot's
// agent chain. It is a kagent BYO agent, built on kagent's Go ADK
// (github.com/kagent-dev/kagent/go/adk), that looks up a customer's order
// via the order-db MCP server and summarizes it.
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

	// Wire order-db as a tool source. ORDER_DB_URL points at the k8s Service
	// once deployed (a later phase's usecase spec), or localhost:8080 for
	// local dev.
	toolsets := adkmcp.CreateToolsets(ctx, []adk.HttpMcpServerConfig{
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("ORDER_DB_URL", "http://localhost:8080/mcp")}},
	}, nil /* no SSE servers */, false /* propagateToken */, nil /* headerProvider */)

	supportTriage, err := llmagent.New(llmagent.Config{
		Name:        "support_triage",
		Description: "Triages a customer's return/refund request and looks up their order",
		Instruction: "You are a retail support agent. Given a customer's return request, " +
			"use the order-db tools to look up their order and summarize its status. " +
			"Do not process refunds yourself -- that's a later stage of this demo.",
		Model:    llmModel,
		Toolsets: toolsets,
	})
	if err != nil {
		log.Fatalf("Failed to create support_triage agent: %v", err)
	}

	runnerConfig := runner.Config{
		AppName:        "support-triage",
		Agent:          supportTriage,
		SessionService: adksession.InMemoryService(),
	}
	var runConfig adkagent.RunConfig
	runConfig.StreamingMode = adkagent.StreamingModeSSE
	executor := adka2a.NewExecutor(adka2a.ExecutorConfig{RunnerConfig: runnerConfig, RunConfig: runConfig})

	kagentApp, err := app.New(app.AppConfig{
		AgentCard: a2atype.AgentCard{
			Name:        "support-triage",
			Description: "Retail support triage agent -- first hop in the returns copilot chain",
			Version:     "0.1.0",
			URL:         envOr("AGENT_CARD_URL", "http://localhost:8080"),
			Capabilities: a2atype.AgentCapabilities{
				Streaming:              true,
				StateTransitionHistory: true,
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
