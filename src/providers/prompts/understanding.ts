/**
 * Understanding Prompt - Codebase analysis for init
 *
 * Input: Codebase (agent reads files via tools)
 * Output: Single JSON with project understanding
 * Speed: Fast (reads 3-5 files max)
 */

import {
  JSON_OUTPUT_INSTRUCTION,
  PROJECT_TYPES_PROMPT,
  FEATURE_PRIORITY_PROMPT,
} from './constants.js';

export interface UnderstandingContext {
  existingDocsSummary?: string;
}

export function buildUnderstandingPrompt(ctx: UnderstandingContext): string {
  const docsSection = ctx.existingDocsSummary
    ? `\nEXISTING DOCUMENTATION (use this as starting point):\n${ctx.existingDocsSummary}\n`
    : '';

  return `You are whiterose. Quickly understand this codebase structure.

${JSON_OUTPUT_INSTRUCTION}
${docsSection}
EXPLORATION STRATEGY (be fast, read only key files):
1. Read package.json / go.mod / Cargo.toml / pyproject.toml to identify project type
2. Read the main entry point (index.ts, main.go, app.py, etc.)
3. Skim 2-3 core files to understand architecture patterns
4. DO NOT over-explore - focus on structure, not implementation details

${PROJECT_TYPES_PROMPT}

FRAMEWORK DETECTION:
Look for: next.js, express, fastify, nest.js, react, vue, angular, svelte, django, flask, fastapi, gin, echo, spring, rails, laravel, etc.
If none detected, use "none"

${FEATURE_PRIORITY_PROMPT}

OUTPUT FORMAT - Wrap your response in <json></json> tags:

<json>
{
  "summary": {
    "type": "api",
    "framework": "express",
    "language": "typescript",
    "description": "REST API for e-commerce platform with user authentication, product catalog, and order management"
  },
  "features": [
    {
      "name": "User Authentication",
      "description": "JWT-based auth with login, register, password reset, and session management",
      "priority": "critical",
      "relatedFiles": ["src/auth/login.ts", "src/auth/jwt.ts", "src/middleware/auth.ts"]
    },
    {
      "name": "Order Processing",
      "description": "Create, update, track, and fulfill customer orders with payment integration",
      "priority": "high",
      "relatedFiles": ["src/orders/create.ts", "src/orders/status.ts", "src/payments/stripe.ts"]
    }
  ],
  "entryPoints": [
    { "file": "src/index.ts", "type": "main" },
    { "file": "src/routes/api.ts", "type": "routes" }
  ],
  "structure": {
    "srcDir": "src",
    "hasTests": true,
    "hasTypes": true,
    "packageManager": "npm"
  },
  "contracts": []
}
</json>

REQUIREMENTS:
- Output MUST be valid JSON wrapped in <json></json> tags
- type MUST be one of: api, web-app, fullstack, cli, library, monorepo, mobile, desktop, other
- priority MUST be one of: critical, high, medium, low
- Be FAST - read 3-5 files maximum
- Focus on WHAT the project does, not HOW it implements it
- List ALL features you can identify with their priority

Now quickly understand this codebase and output the JSON.`;
}
