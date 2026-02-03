# whiterose

[![npm version](https://img.shields.io/npm/v/@shakecodeslikecray/whiterose.svg)](https://www.npmjs.com/package/@shakecodeslikecray/whiterose)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20NC%201.0-blue.svg)](LICENSE)
[![Test Coverage](https://img.shields.io/badge/coverage-93%25-brightgreen.svg)]()

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

- **Leverages Existing AI Agents**: Uses Claude Code, Aider, or other LLM CLI tools you already have
- **Real-Time Progress**: See exactly which files are being analyzed as it happens
- **Grounded in Reality**: Uses static analysis (tsc, eslint) as signals. Requires code path traces.
- **Intent-Aware**: Merges your existing documentation with AI-generated understanding
- **Provider Agnostic**: Works with Claude Code, Aider, Codex, and more
- **Fix Any Bug**: Fix whiterose-found bugs, import from SARIF files, GitHub issues, or describe manually
- **Interactive Menu**: Just run `whiterose` to get started

---

## Three-Layer Architecture

whiterose operates in three distinct layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 0: DOCUMENTATION                           │
│                         (whiterose init)                            │
│                                                                     │
│  Reads existing docs:               AI generates understanding:     │
│  - README.md                        - Project type                  │
│  - package.json                     - Framework detection           │
│  - CONTRIBUTING.md                  - Feature extraction            │
│  - .env.example                     - Behavioral contracts          │
│  - API docs                         - Architecture mapping          │
│                                                                     │
│  Output: .whiterose/intent.md + .whiterose/cache/understanding.json │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 1: BUG FINDING                             │
│                        (whiterose scan)                             │
│                                                                     │
│  1. Load understanding from Layer 0                                 │
│  2. Run static analysis (tsc, eslint) as pre-filter                 │
│  3. Spawn LLM agent to explore codebase                             │
│  4. Stream progress in real-time                                    │
│  5. Collect bugs with evidence and code paths                       │
│                                                                     │
│  Output: .whiterose/reports/*.sarif + BUGS.md                       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 2: BUG FIXING                              │
│                         (whiterose fix)                             │
│                                                                     │
│  Bug Sources:                       Fix Actions:                    │
│  - whiterose scan results           - Interactive TUI               │
│  - External SARIF files             - Single bug by ID              │
│  - GitHub issues                    - Dry-run preview               │
│  - Manual description               - Branch creation               │
│                                                                     │
│  Output: Fixed code + commits                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Architecture: How whiterose Actually Works

**This section is critical to understanding what whiterose is and isn't.**

### What whiterose IS

whiterose is an **orchestrator/wrapper** that:
1. Spawns an LLM CLI tool (like Claude Code) as a subprocess
2. Passes it a specialized prompt with a communication protocol
3. Streams and parses the LLM's output in real-time
4. Displays progress to the user
5. Collects and formats bug reports

### What whiterose IS NOT

whiterose is **NOT** a custom AI agent with its own tool-calling loop. It does not:
- Make direct API calls to Claude/OpenAI/etc.
- Define or execute its own tools
- Implement an LLM-in-a-loop architecture itself

### The Real Agent: Your LLM Provider

The actual "agent" is **Claude Code** (or Aider, etc.). These tools have their own internal agentic architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE                                 │
│                    (The Actual AI Agent)                            │
│                                                                     │
│   Claude Code runs an internal agent loop:                          │
│                                                                     │
│     while (task not complete):                                      │
│       1. LLM decides what to do next                                │
│       2. LLM issues a tool call (Read, Glob, Grep, Bash, etc.)      │
│       3. Claude Code executes the tool locally                      │
│       4. Tool result is sent back to the LLM                        │
│       5. LLM processes result and decides next action               │
│       6. Repeat until done                                          │
│                                                                     │
│   Built-in Tools:                                                   │
│     - Read: Read file contents                                      │
│     - Glob: Find files by pattern                                   │
│     - Grep: Search file contents                                    │
│     - Bash: Execute shell commands                                  │
│     - Write/Edit: Modify files                                      │
│     - Task: Spawn sub-agents                                        │
│     - And more...                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### The Complete Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER                                       │
│                     runs: whiterose scan                            │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        WHITEROSE CLI                                │
│                                                                     │
│  1. Loads config from .whiterose/config.yml                         │
│  2. Loads codebase understanding from cache                         │
│  3. Runs static analysis (tsc, eslint) as pre-filter                │
│  4. Spawns Claude Code as subprocess:                               │
│                                                                     │
│     claude --dangerously-skip-permissions -p "<prompt>"             │
│                                                                     │
│  5. Streams stdout from Claude Code                                 │
│  6. Parses protocol markers in real-time                            │
│  7. Updates UI with progress                                        │
│  8. Collects bug reports                                            │
│  9. Outputs SARIF + Markdown reports                                │
│                                                                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ spawns
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CLAUDE CODE                                   │
│                   (runs autonomously)                               │
│                                                                     │
│  Receives prompt telling it to:                                     │
│  - Explore the codebase                                             │
│  - Find bugs in specific categories                                 │
│  - Output progress using protocol markers                           │
│  - Output bugs as JSON                                              │
│                                                                     │
│  Claude Code then:                                                  │
│  - Uses its Read tool to examine files                              │
│  - Uses Glob/Grep to find relevant code                             │
│  - Analyzes code for bugs                                           │
│  - Outputs markers that whiterose parses                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### The Communication Protocol

whiterose and the LLM communicate via stdout using protocol markers:

```
###SCANNING:src/api/users.ts       <- LLM is about to analyze this file
###SCANNING:src/api/auth.ts        <- LLM moved to next file
###BUG:{"file":"src/api/users.ts","line":42,"title":"Null dereference",...}
###SCANNING:src/hooks/useCart.ts   <- LLM continues exploring
###BUG:{"file":"src/hooks/useCart.ts","line":17,"title":"Missing await",...}
###COMPLETE                         <- LLM finished analysis
```

whiterose parses these markers in real-time to:
- Show progress: "Scanning: src/api/users.ts"
- Show findings: "Found: Null dereference (high)"
- Collect bugs for the final report

### Why This Architecture?

1. **No API Keys Needed**: Uses CLI tools you already have installed and authenticated
2. **Zero Extra Cost**: Piggybacks on your existing subscriptions (Claude Max, etc.)
3. **Real Progress**: Streaming output shows exactly what's happening
4. **Leverages Existing Agents**: Claude Code already knows how to explore codebases intelligently
5. **Respects .gitignore**: Claude Code automatically ignores files you don't want scanned
6. **No Token Limits**: Claude Code reads files on-demand, not all at once

---

## Installation

```bash
npm install -g @shakecodeslikecray/whiterose
```

The CLI command is `whiterose` (no scope prefix needed).

### Prerequisites

You need at least one of these LLM CLI tools installed:

| Provider | Installation | Status |
|----------|-------------|--------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | Ready |
| Aider | `pip install aider-chat` | Coming Soon |
| Codex | OpenAI CLI | Coming Soon |
| Gemini | Google CLI | Coming Soon |

## Quick Start

```bash
# Interactive menu (recommended)
whiterose

# Or use commands directly:
whiterose init    # Initialize (explores codebase, generates understanding)
whiterose scan    # Scan for bugs
whiterose fix     # Fix bugs interactively
```

Running `whiterose` without arguments shows an interactive menu:

```
██╗    ██╗██╗  ██╗██╗████████╗███████╗██████╗  ██████╗ ███████╗███████╗
...

  Project: my-app
  Status: initialized

? What would you like to do?
  > Scan       find bugs in the codebase
    Fix        fix bugs interactively
    Status     show current status
    Report     generate bug report
    Refresh    rebuild codebase understanding
    Help       show all commands
    Exit
```

## Commands

### `whiterose init`

First-time setup. whiterose will:
1. Detect available LLM providers (claude-code, aider, codex, etc.)
2. Ask you to select one
3. Read existing documentation (README, package.json, CONTRIBUTING, etc.)
4. Spawn the LLM to explore and understand your codebase
5. Merge existing docs with AI-generated understanding
6. Show real-time progress as files are examined
7. Create `.whiterose/` directory with config and understanding

**What you'll see:**
```
whiterose - initialization

✓ Detected providers: claude-code, aider
? Which LLM provider should whiterose use?
  > claude-code (recommended)
    aider

✓ Found existing docs: README, package.json, .env.example
Examining: src/index.ts
Examining: src/api/users.ts
...
✓ Analysis complete (45s)

Here's what I understand about your codebase:

  Type: E-commerce Application
  Framework: Next.js
  Language: TypeScript
  Files: 127
  Lines: 15,234

? Is this understanding accurate? Yes

whiterose initialized successfully!
```

### `whiterose scan`

Find bugs. Uses incremental scanning by default (only changed files).

```bash
whiterose scan              # Incremental scan
whiterose scan --full       # Full scan
whiterose scan --json       # JSON output
whiterose scan src/api/     # Scan specific path
whiterose scan --unsafe     # Bypass LLM permission prompts
```

**What you'll see:**
```
whiterose - scanning for bugs

Scanning: src/api/users.ts
Scanning: src/api/auth.ts
Found: Null dereference in getUserById (high)
Scanning: src/hooks/useCart.ts
Found: Missing await in checkout (medium)
...
Analysis complete. Found 3 bugs.

Scan Results

  ● Critical: 0
  ● High: 1
  ● Medium: 2
  ● Low: 0

  Total: 3 bugs found
```

### `whiterose fix`

Interactive TUI for reviewing and fixing bugs. Supports multiple bug sources.

```bash
# From whiterose scan results (default)
whiterose fix               # Interactive dashboard
whiterose fix WR-001        # Fix specific bug
whiterose fix --dry-run     # Preview fixes without applying
whiterose fix --branch fix/bugs   # Create fixes in new branch

# From external SARIF file
whiterose fix --sarif ./reports/semgrep.sarif

# From GitHub issue
whiterose fix --github https://github.com/owner/repo/issues/123

# Manually describe a bug
whiterose fix --describe
```

**External Bug Sources:**

| Source | Option | Description |
|--------|--------|-------------|
| whiterose scan | (default) | Bugs from latest scan in `.whiterose/reports/` |
| External SARIF | `--sarif <path>` | Import bugs from any SARIF-compatible tool |
| GitHub Issue | `--github <url>` | Parse bug from GitHub issue (requires `gh` CLI) |
| Manual | `--describe` | Interactive prompts to describe a bug |

When using `--github`, whiterose:
- Extracts file path and line number from issue body (if present)
- Determines severity from labels (critical, security, bug, etc.)
- Prompts for missing information

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
| Claude Code | Ready | Recommended. Uses Max subscription. |
| Aider | Coming Soon | Will support when implemented |
| Codex | Coming Soon | Will support when implemented |
| Gemini | Coming Soon | Will support when implemented |
| Ollama | Coming Soon | Local LLMs |

## Bug Categories

whiterose looks for bugs in these categories:

- **logic-error**: Off-by-one errors, wrong operators, incorrect conditions
- **null-reference**: Accessing properties on potentially null/undefined values
- **security**: Injection, auth bypass, XSS, data exposure
- **async-race-condition**: Missing await, unhandled promises, race conditions
- **edge-case**: Empty arrays, zero values, boundary conditions
- **resource-leak**: Unclosed connections, event listener leaks
- **type-coercion**: Loose equality bugs, implicit conversions
- **intent-violation**: Code that violates documented business rules

## Output Formats

### SARIF

Standard format for static analysis tools. Works with:
- VS Code (SARIF Viewer extension)
- GitHub Code Scanning
- Azure DevOps

### Markdown

Human-readable report with:
- Bug severity badges
- Code path traces
- Suggested fixes
- Evidence

## Philosophy

- **SRP**: whiterose finds bugs. It doesn't write tests, lint code, or format files.
- **Leverage, Don't Reinvent**: Uses existing AI agents (Claude Code) rather than building a custom agent loop.
- **Transparency**: Shows exactly what's happening in real-time.
- **Grounded**: Every bug must have evidence and a code path trace.
- **Zero Cost**: Uses your existing LLM subscription.

## Technical Details

### How Provider Detection Works

whiterose checks for installed CLI tools in this order:
1. Checks if command exists in PATH
2. Checks common installation locations:
   - `~/.local/bin/`
   - `/usr/local/bin/`
   - `/opt/homebrew/bin/`

### How Streaming Works

1. whiterose spawns: `claude --verbose -p "<prompt>"` (or with `--dangerously-skip-permissions` if `--unsafe` flag used)
2. Attaches to stdout stream
3. Buffers output line-by-line
4. Parses lines for protocol markers (`###SCANNING:`, `###BUG:`, etc.)
5. Triggers callbacks for UI updates and bug collection

### Security Features

- **Path traversal prevention**: File paths in bug reports are validated to stay within the project directory
- **Opt-in unsafe mode**: LLM permission prompts are shown by default; use `--unsafe` flag to bypass
- **No external network calls**: All analysis happens locally via your LLM CLI

### Protocol Markers

| Marker | Purpose | Example |
|--------|---------|---------|
| `###SCANNING:` | File being analyzed | `###SCANNING:src/api/users.ts` |
| `###BUG:` | Bug found (JSON) | `###BUG:{"file":"...","line":42,...}` |
| `###UNDERSTANDING:` | Codebase understanding (JSON) | `###UNDERSTANDING:{"summary":{...}}` |
| `###COMPLETE` | Analysis finished | `###COMPLETE` |
| `###ERROR:` | Error occurred | `###ERROR:Failed to read file` |

## Roadmap

### v0.2 (Coming Soon)
- [ ] VSCode extension for inline bug display
- [ ] GitHub Actions integration for PR scanning
- [ ] Improved monorepo support
- [ ] Custom bug category definitions

### v0.3
- [ ] Historical bug tracking and trend analysis
- [ ] Team collaboration features
- [ ] Ollama/local LLM support
- [ ] Plugin architecture for custom providers

### v1.0
- [ ] Production-ready stability
- [ ] Enterprise features
- [ ] Comprehensive documentation site
- [ ] IDE integrations (JetBrains, Neovim)

## License

PolyForm Noncommercial 1.0.0

This software is free for non-commercial use. See [LICENSE](LICENSE) for details.

## Credits

Named after the [Mr. Robot](https://en.wikipedia.org/wiki/Mr._Robot) character who sees everything and orchestrates from the shadows.

---

**Required Notice:** Copyright (c) 2024 shakecodeslikecray (https://github.com/shakecodeslikecray)
