# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Overview

This is the source for the Retail Returns guided-tour demo: a small chain of kagent
(Go ADK) agents handles a customer's product return step by step, calling out to
mock MCP servers over agentgateway/AgentRegistry, with a React SPA walking a viewer
through each stage live. It's a companion repo to `agentic-field-kit`, which
provisions the cluster and installs/configures kagent, AgentRegistry, and
agentgateway that this repo's workloads run on. Deep architecture (why each stage
exists, which CRD mechanism it demonstrates) lives in the design docs in that repo,
not here.

Go workspace (`go.work`) of independent modules, one per component, plus a
Vite/React/TypeScript UI.

## Repo layout

```
agents/            kagent BYO agents, chained via A2A:
  support-triage/     looks up an order via order-db, summarizes it
  order-lookup/       looks up an order + shipment status (order-db, shipping)
  fraud-check/        scores fraud risk (fraud-scoring)
  refund-approval/    issues a refund (payment); last hop in the chain
mcp-servers/       mock MCP servers, one tool domain each, no real backend behind any of them:
  order-db/           list_orders, get_order (+ whoami token-exchange diagnostic)
  payment/            get_payment_method, refund_payment
  shipping/           get_shipment_status
  inventory/          check_stock
  fraud-scoring/      score_transaction
  carrier/            link_carrier_account (own Backend - see Gotchas)
  loyalty-rewards/    get_loyalty_balance, award_points (west-cluster only)
  returns-eligibility/ check_return_window, override_return_window (kagent-native
                        MCPServer, not AgentRegistry-catalogued - see Gotchas)
pii-guardrail/     agentgateway ExtMcp guardrails hook; masks PII in tool results
stage-policy-controller/  applies/removes EnterpriseAgentgatewayPolicy CRDs on
                          demand so the UI can toggle a stage's backend policy
ui/                guided-tour SPA (Stage 1-10), Vite + React + TS + shadcn/ui
```

## Commands

```bash
# Go components - go.work is a workspace of independent modules, not one module
# tree, so a bare `./...` from the repo root won't resolve. Target a module's own
# directory instead, e.g.:
go build ./agents/order-lookup/...
go test ./mcp-servers/order-db/... -v
gofmt -l .                      # repo-wide formatting check
golangci-lint run ./agents/...  # run per-module or list explicit paths, per CI

# UI
cd ui
npm install
npm run dev             # dev server
npm run build            # tsc -b + vite build + server build
npm run lint             # oxlint
npm run format:check     # prettier --check
npm test                 # vitest run
```

## Architecture notes

- **Agent chain**: `support-triage` -> `order-lookup` -> `fraud-check` ->
  `refund-approval`, handed off via A2A, each calling one or more MCP servers.
- **pii-guardrail** is agentgateway's `mcp.guardrails` hook (like Envoy ext_authz,
  but at the MCP method layer). It only masks PII on the response path; it never
  denies by tool name, that's `mcp.authorization`'s job.
- **stage-policy-controller** is reachable only from the guided-tour BFF over
  cluster-internal networking. Its RBAC (agentic-field-kit's `stage-policy-rbac`
  feature) is scoped by `resourceNames` to just the policy objects it manages.
- **carrier** is a deliberately separate MCP server/Backend from `shipping`, not a
  second tool on it: agentgateway's `entElicitation` gates at the whole-Backend
  level, so co-locating `link_carrier_account` on shipping's Backend would force
  OAuth consent before the existing Stage 3/4/6/7 A2A chain could run.
- **loyalty-rewards** runs on the west cluster only and is cataloged into east's
  AgentRegistry as a remote server, so `refund-approval` calls a tool on a
  physically different cluster (the multicluster proof, Stage 10).

## Gotchas

- Adding a new Go component (a directory under `agents/`, `mcp-servers/`, or a
  top-level service like `pii-guardrail`) requires updating, together:
  `go.work`'s `use` block, `.golangci.yml`-covered paths, and in
  `.github/workflows/build-images.yml`: the `paths-filter` list, the
  `ALL_GO_COMPONENTS` env var, and the golangci-lint/build/test module-path args.
  CI silently skips anything left off these lists.
- `pii-guardrail` and `stage-policy-controller` live at the repo root, not under
  `agents/` or `mcp-servers/` - the CI image-build step finds their Dockerfile via
  `find . -maxdepth 2 -type d -name "<component>"`, which covers all three shapes.
- `returns-eligibility` is built and pushed by this repo's CI like every other
  MCP server, but deployed differently in `agentic-field-kit`: as a native
  kagent `MCPServer` CR (kagent deploys the pod itself from the image), not the
  plain Kubernetes `Deployment` + AgentRegistry-catalog pattern the other 6
  servers use. Required so kagent's `AccessPolicy` can target it by name/tool
  (Stage 11) - `AccessPolicy`'s `MCPServer` target only resolves against a real
  `MCPServer.kagent.dev` object, not a plain Deployment or `RemoteMCPServer`.
