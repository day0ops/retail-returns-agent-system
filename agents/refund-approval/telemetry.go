package main

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.36.0"
	"google.golang.org/adk/v2/telemetry"
)

// setupTelemetry wires ADK's built-in OTel instrumentation (LLM calls, tool
// execution, agent invocation spans) to the OTLP endpoint kagent injects via
// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT. ADK's own telemetry.New() defaults to an
// HTTP exporter reading that same env var, but the collector's receiver on
// that endpoint's port is gRPC-only (the same transport kagent-controller's
// own exporter already uses successfully) -- so the ambient env vars are read
// once for our own gRPC exporter, then unset before calling telemetry.New(),
// to avoid a second, permanently-failing HTTP exporter running alongside it.
//
// Returns nil, nil if tracing isn't enabled -- callers should treat a nil
// Providers as "tracing disabled", not an error.
func setupTelemetry(ctx context.Context, serviceName string) (*telemetry.Providers, error) {
	if os.Getenv("OTEL_TRACING_ENABLED") != "true" {
		return nil, nil
	}
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if endpoint == "" {
		endpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	}
	if endpoint == "" {
		return nil, nil
	}
	_ = os.Unsetenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	_ = os.Unsetenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")

	grpcOpts := []otlptracegrpc.Option{otlptracegrpc.WithEndpointURL(endpoint)}
	if os.Getenv("OTEL_EXPORTER_OTLP_TRACES_INSECURE") == "true" {
		grpcOpts = append(grpcOpts, otlptracegrpc.WithInsecure())
	}
	exporter, err := otlptracegrpc.New(ctx, grpcOpts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create OTLP trace exporter: %w", err)
	}

	// agentregistry.deployment.name matches the arctl Deployment name
	// (KAGENT_NAME) so AgentRegistry's UI can correlate spans back to the
	// right deployment.
	res, err := sdkresource.New(ctx, sdkresource.WithAttributes(
		semconv.ServiceNameKey.String(serviceName),
		attribute.String("agentregistry.deployment.name", envOr("KAGENT_NAME", serviceName)),
	))
	if err != nil {
		return nil, fmt.Errorf("failed to create OTel resource: %w", err)
	}

	providers, err := telemetry.New(ctx,
		telemetry.WithResource(res),
		telemetry.WithSpanProcessors(sdktrace.NewBatchSpanProcessor(exporter)),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to init ADK telemetry: %w", err)
	}
	providers.SetGlobalOtelProviders()
	return providers, nil
}
