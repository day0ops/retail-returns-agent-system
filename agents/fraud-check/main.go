// Command fraud-check is a kagent BYO agent that scores an order's fraud risk
// via the fraud-scoring MCP server.
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
		Tools:    []adktool.Tool{refundApprovalTool},
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
