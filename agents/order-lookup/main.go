// Command order-lookup is a kagent BYO agent that looks up a customer's order
// and its shipment status via the order-db and shipping MCP servers.
package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	a2atype "github.com/a2aproject/a2a-go/v2/a2a"
	"github.com/go-logr/logr"
	"github.com/go-logr/zapr"
	kagenta2a "github.com/kagent-dev/kagent/go/adk/pkg/a2a"
	"github.com/kagent-dev/kagent/go/adk/pkg/app"
	adkmcp "github.com/kagent-dev/kagent/go/adk/pkg/mcp"
	"github.com/kagent-dev/kagent/go/adk/pkg/models"
	kagentsts "github.com/kagent-dev/kagent/go/adk/pkg/sts"
	kagenttelemetry "github.com/kagent-dev/kagent/go/adk/pkg/telemetry"
	adktools "github.com/kagent-dev/kagent/go/adk/pkg/tools"
	"github.com/kagent-dev/kagent/go/api/adk"
	"go.uber.org/zap"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/runner"
	adksession "google.golang.org/adk/v2/session"
	adktool "google.golang.org/adk/v2/tool"
)

// buildSTSPlugin wires the kagent SDK's built-in STS token-propagation
// plugin when STS_WELL_KNOWN_URI is set: it exchanges the customer JWT
// (forwarded via A2A/HTTP) and this pod's own Kubernetes ServiceAccount
// token for an RFC 8693 delegation token -- one that keeps the customer's
// `sub` but adds a real `act` claim recording this agent as the delegate --
// and injects it into this agent's own outbound MCP tool calls, replacing
// the raw forwarded customer JWT. Returns nil when unset (e.g. local dev),
// leaving propagateToken's raw forwarding as the only behavior.
func buildSTSPlugin(logger logr.Logger) *kagentsts.TokenPropagationPlugin {
	wellKnownURI := strings.TrimSpace(os.Getenv("STS_WELL_KNOWN_URI"))
	if wellKnownURI == "" {
		return nil
	}
	cfg := kagentsts.DefaultSTSConfig(wellKnownURI)
	integration, err := kagentsts.NewSTSIntegration(
		wellKnownURI,
		"",  // serviceAccountTokenPath: default projected-token path
		nil, // fetchActorToken: default to the pod's own SA token
		nil, // getSubjectToken: default to the forwarded bearer token as-is
		cfg.Timeout,
		*cfg.VerifySSL,
		cfg.UseIssuerHost,
	)
	if err != nil {
		log.Fatalf("Failed to initialize STS integration: %v", err)
	}
	return kagentsts.NewTokenPropagationPlugin(integration, logger, nil, nil)
}

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

	// Route LLM calls through the hub agentgateway (LLM_BASE_URL=<gateway>/openai/v1)
	// for cost tracking and telemetry; empty falls back to the OpenAI SDK default
	// for local dev.
	llmModel, err := models.NewOpenAIModelWithLogger(&models.OpenAIConfig{
		Model:   envOr("MODEL_NAME", "gpt-4o-mini"),
		BaseUrl: os.Getenv("LLM_BASE_URL"),
		// Reasoning-class models (e.g. gpt-5.6) reject function tools over
		// /v1/chat/completions unless reasoning_effort is "none"; standard models
		// must leave it nil. Set via MODEL_REASONING_EFFORT only for reasoning models.
		ReasoningEffort: envPtr("MODEL_REASONING_EFFORT"),
	}, logger)
	if err != nil {
		log.Fatalf("Failed to create LLM model: %v", err)
	}

	// STS delegation: when wired, order-lookup's own outbound MCP calls (below)
	// carry a token proving *this agent* acted on the customer's behalf, instead
	// of the raw forwarded customer JWT. See buildSTSPlugin.
	stsPlugin := buildSTSPlugin(logger)
	var pluginConfig runner.PluginConfig
	var mcpHeaderProvider adkmcp.DynamicHeaderProvider
	if stsPlugin != nil {
		mcpHeaderProvider = stsPlugin.HeaderProvider
		stsADKPlugin, err := stsPlugin.ADKPlugin()
		if err != nil {
			log.Fatalf("Failed to create STS ADK plugin: %v", err)
		}
		pluginConfig.Plugins = append(pluginConfig.Plugins, stsADKPlugin)
	}

	// ORDER_DB_URL and SHIPPING_URL point at k8s Service DNS once deployed, or
	// localhost for local dev.
	toolsets := adkmcp.CreateToolsets(ctx, []adk.HttpMcpServerConfig{
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("ORDER_DB_URL", "http://localhost:8080/mcp")}},
		{Params: adk.StreamableHTTPConnectionParams{Url: envOr("SHIPPING_URL", "http://localhost:8081/mcp")}},
	}, nil /* no SSE servers */, nil /* no stdio servers */, true /* propagateToken: forward the customer JWT to MCP calls */, mcpHeaderProvider)

	// Next A2A hop, handing off to fraud_check. The two bools are propagateToken
	// (forward the customer JWT, as with the MCP calls above) and isolateSessions;
	// isolateSessions must be true, see support-triage/main.go's order_lookup tool
	// for why.
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
		PluginConfig:   pluginConfig,
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
			// See support-triage/main.go's AgentCard for why this is required.
			SupportedInterfaces: []*a2atype.AgentInterface{
				a2atype.NewAgentInterface(envOr("AGENT_CARD_URL", "http://localhost:"+envOr("PORT", "8080")), a2atype.TransportProtocolJSONRPC),
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

// envPtr returns a pointer to the env var's value, or nil if unset. Unlike
// envOr, it has no default: ReasoningEffort must stay nil (omitted) when unset.
func envPtr(key string) *string {
	if v := os.Getenv(key); v != "" {
		return &v
	}
	return nil
}
