// Command refund-approval is a kagent BYO agent, built on kagent's Go ADK
// (github.com/kagent-dev/kagent/go/adk), that issues a refund for an order
// via the payment MCP server. It is the last hop in the returns copilot's
// agent chain.
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

	shutdownTelemetry, telemetryEnabled, err := kagenttelemetry.Init(ctx, "refund-approval", envOr("KAGENT_NAMESPACE", "kagent"))
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
		// KAGENT_PRE_RESPONSE_TRACE_FLUSH's per-request flush (see the usecase spec's
		// env block) only fires reliably for this agent's own top-level inbound
		// requests -- confirmed live it does not fire for requests arriving as a
		// nested A2A remote-tool call from another agent, for reasons not fully
		// isolated in kagent's SDK. A periodic flush sidesteps that gap: proven live
		// (via an isolated debug build) to reliably export buffered spans regardless
		// of how the request arrived.
		go func() {
			ticker := time.NewTicker(3 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				kagenttelemetry.ForceFlush(context.Background())
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
		// Low, not zero: the $75 ask_user rule is a deterministic business rule,
		// not a creative task, and this agent measurably skipped it under
		// default temperature (live-tested: 3/12 fresh runs correctly knew the
		// exact refund amount exceeded $75 yet still auto-decided without
		// asking). Some variance is kept rather than 0 so the demo doesn't feel
		// robotic across its other free-text summaries.
		Temperature: floatPtr(0.2),
	}, logger)
	if err != nil {
		log.Fatalf("Failed to create LLM model: %v", err)
	}

	// Wire payment and loyalty-rewards as tool sources. PAYMENT_URL/
	// LOYALTY_URL point at their respective k8s Services once deployed, or
	// localhost for local dev. loyalty-rewards-mcp runs on the west cluster
	// (Phase 10, multicluster) -- LOYALTY_URL routes through agentgateway's
	// hub-to-AgentRegistry-to-spoke chain, invisible to this agent, which
	// just sees an ordinary MCP endpoint.
	toolsets := adkmcp.CreateToolsets(ctx, []adk.HttpMcpServerConfig{
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("PAYMENT_URL", "http://localhost:8080/mcp")}},
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("LOYALTY_URL", "http://localhost:8081/mcp")}},
	}, nil /* no SSE servers */, nil /* no stdio servers */, true /* propagateToken: forward the customer JWT to MCP calls */, nil /* headerProvider */)

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
			"method, then determine the refund amount: use the exact amount you were given " +
			"if one was given, otherwise a standard full-refund amount of $49.99. " +
			"The $75 refund-method rule is mandatory, not a judgment call: if the refund " +
			"amount exceeds $75, you MUST call the ask_user tool to ask the customer to " +
			"choose between a cash refund and store credit BEFORE calling refund_payment -- " +
			"you are not permitted to call refund_payment first or decide the method " +
			"yourself. Below $75, call refund_payment directly with a cash refund, no " +
			"question needed. After the refund itself is settled, ALWAYS award a loyalty " +
			"goodwill bonus regardless of which refund method was chosen: call " +
			"get_loyalty_balance for the customer, then award_points with the refund " +
			"amount (not a point value -- award_points computes the point award itself) " +
			"and reason \"return goodwill bonus\". State a clear final outcome for the " +
			"customer: approved/denied, amount, refund method, and the new loyalty " +
			"points balance.",
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
	executor := kagenta2a.NewKAgentExecutor(kagenta2a.KAgentExecutorConfig{
		RunnerConfig: runnerConfig,
		Stream:       true,
		AppName:      "refund-approval",
		Logger:       logger,
	})

	kagentApp, err := app.New(app.AppConfig{
		AgentCard: a2atype.AgentCard{
			Name:        "refund-approval",
			Description: "Retail refund approval agent -- last hop in the returns copilot chain",
			Version:     "0.1.0",
			Capabilities: a2atype.AgentCapabilities{
				Streaming: true,
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

// envPtr returns a pointer to the env var's value, or nil if unset -- distinct
// from envOr's fallback-to-default since an unset ReasoningEffort must stay
// nil (omitted from the request) rather than fall back to some string value.
func envPtr(key string) *string {
	if v := os.Getenv(key); v != "" {
		return &v
	}
	return nil
}

// floatPtr returns a pointer to v -- OpenAIConfig.Temperature is a *float64
// so an unset value can be told apart from an explicit 0.
func floatPtr(v float64) *float64 {
	return &v
}
