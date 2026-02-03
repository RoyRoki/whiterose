# whiterose

> "I've been staring at your code for a long time."

AI-powered bug hunter that uses your existing LLM subscription. No API keys needed. No extra costs.

```
██╗    ██╗██╗  ██╗██╗████████╗███████╗██████╗  ██████╗ ███████╗███████╗
██║    ██║██║  ██║██║╚══██╔══╝██╔════╝██╔══██╗██╔═══██╗██╔════╝██╔════╝
██║ █╗ ██║███████║██║   ██║   █████╗  ██████╔╝██║   ██║███████╗█████╗
██║███╗██║██╔══██║██║   ██║   ██╔══╝  ██╔══██╗██║   ██║╚════██║██╔══╝
╚███╔███╔╝██║  ██║██║   ██║   ███████╗██║  ██║╚██████╔╝███████║███████╗
 ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝
```

## Why whiterose?

You're already paying for Claude Code Max, Cursor, Codex, or similar AI coding tools. Why pay again for bug detection APIs?

whiterose piggybacks on your existing subscription to find bugs in your code. Zero additional cost.

## Features

- **AI-Agent-First**: Not a dumb tool that calls AI. An intelligent agent that understands your codebase.
- **Grounded in Reality**: Uses static analysis (tsc, eslint) as signals. Requires code path traces. Adversarial self-validation.
- **Intent-Aware**: Uses your product documentation (or generates one) to understand what the code *should* do.
- **Provider Agnostic**: Works with Claude Code, Aider, Codex, and more.
- **SRP**: Finds bugs. Doesn't write tests. One job, done well.

## Installation

```bash
npm install -g whiterose
```

## Quick Start

```bash
# Initialize (scans codebase, asks questions, generates config)
whiterose init

# Scan for bugs
whiterose scan

# Fix bugs interactively
whiterose fix
```

## Commands

### `whiterose init`

First-time setup. whiterose will:
1. Scan your entire codebase
2. Generate an understanding of your app
3. Ask smart questions to confirm and prioritize
4. Create `.whiterose/` directory with config and intent doc

### `whiterose scan`

Find bugs. Uses incremental scanning by default (only changed files).

```bash
whiterose scan              # Incremental scan
whiterose scan --full       # Full scan
whiterose scan --json       # JSON output
whiterose scan src/api/     # Scan specific path
```

### `whiterose fix`

Interactive TUI for reviewing and fixing bugs.

```bash
whiterose fix               # Interactive dashboard
whiterose fix WR-001        # Fix specific bug
whiterose fix --dry-run     # Preview fixes without applying
```

### `whiterose refresh`

Rebuild codebase understanding from scratch.

### `whiterose status`

Show current status (provider, cache, last scan).

### `whiterose report`

Generate bug report from last scan.

## Configuration

`.whiterose/config.yml`:

```yaml
version: "1"
provider: claude-code

include:
  - "**/*.ts"
  - "**/*.tsx"

exclude:
  - node_modules
  - dist
  - "**/*.test.*"

priorities:
  src/api/checkout.ts: critical
  src/auth/: high

categories:
  - logic-error
  - security
  - async-race-condition
  - edge-case
  - null-reference

minConfidence: low

staticAnalysis:
  typescript: true
  eslint: true

output:
  sarif: true
  markdown: true
```

## Intent Document

`.whiterose/intent.md` describes your app's intent and behavioral contracts:

```markdown
# App Intent: acme-store

## Overview
E-commerce platform for selling widgets.

## Critical Features

### Checkout [CRITICAL]
Must never double-charge. Must handle payment failures gracefully.

**Constraints:**
- Create order record before charging payment
- Rollback order if charge fails

---

## Behavioral Contracts

### `src/api/checkout.ts:processPayment()`

**Inputs:**
- `cartId`: string
- `paymentMethod`: stripe | paypal

**Returns:** `PaymentResult`

**Invariants:**
- Must not charge if inventory unavailable
- Must create order before charging
- Must rollback if charge fails
```

## Supported Providers

| Provider | Status | Notes |
|----------|--------|-------|
| Claude Code | ✅ Ready | Recommended. Uses Max subscription. |
| Aider | 🚧 WIP | Coming soon |
| Codex | 🚧 WIP | Coming soon |
| OpenCode | 🚧 WIP | Coming soon |

## How It Works

1. **Init Phase**: Full codebase scan → AI generates understanding → User confirms/prioritizes → Config generated

2. **Scan Phase**:
   - Incremental change detection (hash-based)
   - Static analysis (tsc, eslint) as pre-filter
   - LLM analysis with code path traces
   - Adversarial validation ("prove this isn't a bug")
   - Confidence scoring

3. **Output**: SARIF (for IDEs) + Markdown (for humans)

## Philosophy

- **SRP**: whiterose finds bugs. It doesn't write tests, lint code, or format files.
- **Grounded**: Every bug must have a code path trace and evidence.
- **Skeptical**: Adversarial self-validation reduces hallucinations.
- **Intent-Aware**: Uses documentation to understand what code *should* do.
- **Zero Cost**: Uses your existing LLM subscription.

## License

MIT

## Credits

Named after the [Mr. Robot](https://en.wikipedia.org/wiki/Mr._Robot) character who sees everything and orchestrates from the shadows.
