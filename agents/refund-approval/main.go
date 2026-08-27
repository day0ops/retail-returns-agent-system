// Command refund-approval is a kagent BYO agent, built on kagent's Go ADK
// (github.com/kagent-dev/kagent/go/adk), that issues a refund for an order
// via the payment MCP server. It is the last hop in the returns copilot's
// agent chain.
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
	adktools "github.com/kagent-dev/kagent/go/adk/pkg/tools"
	"github.com/kagent-dev/kagent/go/api/adk"
	"go.uber.org/zap"
	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/adk/v2/server/adka2a" //nolint:staticcheck // kagent still uses a2a-go v1; this ADK package is the compatibility adapter.
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
		// gpt-5.6 (agentgateway's current default, overriding whatever model is
		// requested here) rejects function tools over /v1/chat/completions unless
		// reasoning_effort is explicitly "none" -- it's a reasoning-class model.
		ReasoningEffort: stringPtr("none"),
	}, logger)
	if err != nil {
		log.Fatalf("Failed to create LLM model: %v", err)
	}

	// Wire payment as a tool source. PAYMENT_URL points at the k8s Service
	// once deployed (a later phase's usecase spec), or localhost:8080 for
	// local dev.
	toolsets := adkmcp.CreateToolsets(ctx, []adk.HttpMcpServerConfig{
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("PAYMENT_URL", "http://localhost:8080/mcp")}},
	}, nil /* no SSE servers */, true /* propagateToken: forward the customer JWT to MCP calls */, nil /* headerProvider */)

	// Elicitation (Stage 3 of the guided tour): for a high-value refund, pause
	// and ask the customer a real question instead of deciding unilaterally.
	// ask_user is kagent's own SDK tool -- no custom pause/resume codec needed
	// here, the agent just calls it like any other tool.
	askUserTool, err := adktools.NewAskUserTool()
	if err != nil {
		log.Fatalf("Failed to create ask_user tool: %v", err)
	}

	refundApproval, err := llmagent.New(llmagent.Config{
		Name:        "refund_approval",
		Description: "Issues a refund for an approved return",
		Instruction: "You are a refund approval agent and the last hop in an automated " +
			"return chain -- there is no human to ask a follow-up question about anything " +
			"except the refund method below, so conclude the request yourself otherwise. " +
			"Given a customer's order ID, use the payment tools to look up their payment " +
			"method. If no exact refund amount was given to you, use a standard full-refund " +
			"amount of $49.99. If the refund amount exceeds $75, use the ask_user tool to " +
			"ask the customer to choose between a cash refund and store credit before " +
			"issuing it -- do not decide this for them. Below $75, issue a cash refund " +
			"without asking. State a clear final outcome (approved/denied, amount, and " +
			"refund method) for the customer.",
		Model:    llmModel,
		Toolsets: toolsets,
		Tools:    []adktool.Tool{askUserTool},
	})
	if err != nil {
		log.Fatalf("Failed to create refund_approval agent: %v", err)
	}

	runnerConfig := runner.Config{
		AppName:        "refund-approval",
		Agent:          refundApproval,
		SessionService: adksession.InMemoryService(),
	}
	var runConfig adkagent.RunConfig
	runConfig.StreamingMode = adkagent.StreamingModeSSE
	executor := adka2a.NewExecutor(adka2a.ExecutorConfig{RunnerConfig: runnerConfig, RunConfig: runConfig})

	kagentApp, err := app.New(app.AppConfig{
		AgentCard: a2atype.AgentCard{
			Name:        "refund-approval",
			Description: "Retail refund approval agent -- last hop in the returns copilot chain",
			Version:     "0.1.0",
			URL:         envOr("AGENT_CARD_URL", "http://localhost:8080"),
			Capabilities: a2atype.AgentCapabilities{
				Streaming:              true,
				StateTransitionHistory: true,
			},
			DefaultInputModes:  []string{"text/plain"},
			DefaultOutputModes: []string{"text/plain"},
			Skills: []a2atype.AgentSkill{
				{ID: "approve-refund", Name: "Approve Refund", Description: "Issue a refund for an approved return"},
			},
		},
		Port:   envOr("PORT", "8080"),
		Logger: logger,
		Agent:  refundApproval,
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

func stringPtr(s string) *string {
	return &s
}
