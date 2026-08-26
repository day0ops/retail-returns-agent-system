<div align="center">

# Retail Returns Copilot

*A guided tour of AI agents handling customer returns - built on kagent, agentregistry, and agentgateway.*

![build](https://github.com/day0ops/retail-returns-copilot/actions/workflows/build-images.yml/badge.svg)
![go version](https://img.shields.io/badge/go-1.26-00ADD8?logo=go)

</div>

## What is this

This repo is the source for a demo where a small team of AI agents handles a
customer's product return, step by step, in front of a live audience. You
watch an agent look up an order, check it for fraud signals, and approve a
refund, all backed by real infrastructure rather than a scripted mock.

## Repo layout

```
agents/
  support-triage/
  order-lookup/
  fraud-check/
  refund-approval/
mcp-servers/
  order-db/
  payment/
  shipping/
  inventory/
  fraud-scoring/
ui/                      # guided-tour SPA + BFF
.github/workflows/
  build-images.yml       # path-filtered matrix build -> GCP Artifact Registry
```

## Learn more

For the full technical architecture (why these decisions were made, the
guided-tour stages, and the CRD mechanisms each stage relies on), see the
design doc in the `agentic-field-kit` repo.
