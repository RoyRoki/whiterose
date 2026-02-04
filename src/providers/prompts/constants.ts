/**
 * Shared constants for whiterose prompts
 */

// ─────────────────────────────────────────────────────────────
// LOC Slabs for tiered scanning
// ─────────────────────────────────────────────────────────────

export type Slab = 'XS' | 'S' | 'M' | 'L' | 'XL';

export const SLAB_THRESHOLDS = {
  XS: 5000,      // < 5K LOC
  S: 20000,      // 5K - 20K LOC
  M: 100000,     // 20K - 100K LOC
  L: 500000,     // 100K - 500K LOC
  // XL: > 500K LOC
} as const;

export function detectSlab(totalLOC: number): Slab {
  if (totalLOC < SLAB_THRESHOLDS.XS) return 'XS';
  if (totalLOC < SLAB_THRESHOLDS.S) return 'S';
  if (totalLOC < SLAB_THRESHOLDS.M) return 'M';
  if (totalLOC < SLAB_THRESHOLDS.L) return 'L';
  return 'XL';
}

export function getScopeInstructions(slab: Slab): string {
  switch (slab) {
    case 'XS':
    case 'S':
      return 'SCOPE: Analyze ALL files in the codebase. This is a small project - be thorough.';
    case 'M':
      return 'SCOPE: Focus on entry points, API routes, and data processing. You may read other files for context but prioritize critical paths (auth, payments, user data).';
    case 'L':
      return 'SCOPE: Focus on security boundaries and critical data flows. Trace user input through processing to output. Prioritize: authentication, authorization, database operations, file handling.';
    case 'XL':
      return 'SCOPE: STRICT - Focus only on changed files and their immediate dependencies. Do not explore the entire codebase. Analyze security implications of changes.';
  }
}

// ─────────────────────────────────────────────────────────────
// Bug Categories
// ─────────────────────────────────────────────────────────────

export const BUG_CATEGORIES_PROMPT = `BUG CATEGORIES (use EXACTLY these strings):
SECURITY:
- injection: SQL injection, XSS, command injection, path traversal, SSRF
- auth-bypass: Authentication/authorization flaws, privilege escalation, session issues
- secrets-exposure: Hardcoded credentials, leaked tokens, exposed API keys, sensitive data in logs

RELIABILITY:
- null-reference: Null/undefined dereference, missing optional chaining, unchecked return values
- boundary-error: Off-by-one, array out of bounds, integer overflow/underflow, loop boundary issues
- resource-leak: Unclosed connections, file handles, memory leaks, uncleared timers/intervals
- async-issue: Missing await, unhandled promise rejections, race conditions, callback errors

CORRECTNESS:
- logic-error: Wrong operators, incorrect conditions, bad math, wrong comparisons, inverted logic
- data-validation: Missing input validation, format checking, sanitization, constraint violations
- type-coercion: Implicit coercion bugs, wrong type handling, NaN propagation, falsy confusion

DESIGN:
- concurrency: Thread safety, deadlocks, shared state mutation, atomic operation violations
- intent-violation: Code contradicts comments, misleading names, unexpected side effects`;

// ─────────────────────────────────────────────────────────────
// Severity Definitions
// ─────────────────────────────────────────────────────────────

export const SEVERITY_DEFINITIONS_PROMPT = `SEVERITY DEFINITIONS:
- critical: Security breach allowing unauthorized access, data exfiltration, RCE. Production crash affecting ALL users. Data corruption/loss.
- high: Bugs that WILL cause incorrect behavior for MANY users under normal usage. Partial data corruption. Security issues with limited scope.
- medium: Bugs that COULD cause issues under specific conditions. Edge cases. Non-critical security hardening.
- low: Minor issues. Defensive improvements. Code that works but is fragile.`;

// ─────────────────────────────────────────────────────────────
// Project Types
// ─────────────────────────────────────────────────────────────

export const PROJECT_TYPES_PROMPT = `PROJECT TYPE OPTIONS (pick the best fit):
- api: REST/GraphQL backend service
- web-app: Frontend web application (React, Vue, Angular, etc.)
- fullstack: Combined frontend + backend in one repo
- cli: Command-line tool
- library: Reusable package/module for other projects
- monorepo: Multi-package repository
- mobile: Mobile application (React Native, Flutter, etc.)
- desktop: Desktop application (Electron, Tauri, etc.)
- other: Doesn't fit above categories`;

// ─────────────────────────────────────────────────────────────
// Feature Priority Rules
// ─────────────────────────────────────────────────────────────

export const FEATURE_PRIORITY_PROMPT = `FEATURE PRIORITY RULES:
- critical: Authentication, payments, checkout, admin access, data encryption, secrets management
- high: User data handling, API endpoints, database operations, file uploads, external integrations
- medium: UI components, formatting, logging, caching, search, notifications
- low: Dev tooling, documentation generation, tests, examples, analytics`;

// ─────────────────────────────────────────────────────────────
// Output Format Constants
// ─────────────────────────────────────────────────────────────

export const JSON_OUTPUT_INSTRUCTION = `CRITICAL OUTPUT RULE: All output MUST be valid JSON wrapped in <json></json> tags. No explanations, no markdown, no prose outside the tags.`;

export const TYPESCRIPT_WARNING = `CRITICAL: DO NOT trust TypeScript type annotations. Types exist only at compile-time. A variable typed as 'string' can be null/undefined at runtime. Always verify actual runtime guards.`;

// ─────────────────────────────────────────────────────────────
// Chain-of-Thought Analysis Methodology
// ─────────────────────────────────────────────────────────────

export const CHAIN_OF_THOUGHT_METHODOLOGY = `CHAIN-OF-THOUGHT ANALYSIS METHODOLOGY:

For EACH function/method you analyze, follow these steps IN ORDER:

**STEP 1: UNDERSTAND**
- What does this function do? (1 sentence summary)
- What are the inputs? (parameters, external data, config, environment)
- What are the outputs? (return value, side effects, mutations)

**STEP 2: TRACE INPUTS**
For each input:
- Where does it come from? (user input, database, API, config, hardcoded)
- Is it validated/sanitized before use? WHERE is this validation?
- What assumptions does the code make about this input?

**STEP 3: ANALYZE OPERATIONS**
For each operation on the input:
- What happens if the input is NULL or UNDEFINED?
- What happens if the input is an EMPTY STRING or EMPTY ARRAY?
- What happens if the input is MALFORMED (wrong type, invalid format)?
- What happens if the input is MALICIOUS (SQL injection, path traversal)?
- What happens if the operation FAILS (throws, returns error)?

**STEP 4: CHECK ERROR PATHS**
- Are all error cases handled?
- Do error handlers clean up resources?
- Can errors leak sensitive information?
- Are errors logged with appropriate detail?

**STEP 5: VERIFY CLAIMS**
Before reporting a bug, VERIFY:
- Is there a guard/check I missed upstream?
- Does the framework/library handle this case?
- Is this intentional behavior (check comments, docs)?
- Can I construct a concrete scenario that triggers this bug?

**STEP 6: CONSTRUCT PROOF**
For each bug you report:
- Show the exact data flow from input to failure
- Provide a concrete example input that triggers the bug
- Explain why existing guards don't prevent it
- Provide the exact code fix`;

// ─────────────────────────────────────────────────────────────
// Category-Specific Analysis Instructions
// ─────────────────────────────────────────────────────────────

export const CATEGORY_SPECIFIC_INSTRUCTIONS: Record<string, string> = {
  'injection': `INJECTION ANALYSIS FOCUS:

Trace ALL user inputs through the code:
1. HTTP request: req.body, req.query, req.params, req.headers
2. Form data, file uploads, cookies
3. URL parameters, hash fragments
4. WebSocket messages, GraphQL variables

For EACH user input, check if it reaches:
- SQL queries (concatenation or interpolation = bug)
- Shell commands (exec, spawn, system = bug)
- File system paths (readFile, writeFile with user path = bug)
- HTML rendering (innerHTML, dangerouslySetInnerHTML = bug)
- eval() or Function() constructor = bug
- Regular expressions (ReDoS potential)

PROOF REQUIRED: Show the exact line where user input enters, and the exact line where it's used unsafely.`,

  'null-reference': `NULL REFERENCE ANALYSIS FOCUS:

For EACH variable access (obj.prop, arr[i]), verify:
1. Can the object be null/undefined at this point?
2. Can the property be missing?
3. Can the array be empty?

Check these sources of null:
- Database queries: findOne, findById return null when not found
- API responses: external data can have missing fields
- Optional parameters: function called without all args
- Async operations: resolved value could be null
- Array operations: find(), [0] on empty array
- Map/Object access: map.get(), obj[key] for missing keys

PROOF REQUIRED: Show the exact function that can return null, and the exact line where it's dereferenced without check.`,

  'resource-leak': `RESOURCE LEAK ANALYSIS FOCUS:

Track ALL resources that need cleanup:
1. setInterval/setTimeout - need clearInterval/clearTimeout
2. addEventListener - need removeEventListener
3. File handles - need close()
4. Database connections - need release/close
5. Streams - need destroy/end
6. Subscriptions - need unsubscribe

For EACH resource allocation:
- Is there a corresponding cleanup?
- Is cleanup called in ALL code paths (including errors)?
- Is cleanup in finally block or equivalent?
- For React: is cleanup in useEffect return?
- For classes: is cleanup in destructor/dispose?

PROOF REQUIRED: Show where resource is created, and show the error path where cleanup is skipped.`,

  'async-issue': `ASYNC/CONCURRENCY ANALYSIS FOCUS:

Check ALL async operations:
1. Every async function call should have await (or intentional fire-and-forget with comment)
2. Every Promise should have .catch() or be in try/catch
3. Promise.all errors should be handled

Check for race conditions:
1. Shared state modified by concurrent operations
2. Check-then-act patterns without atomicity
3. Multiple awaits with interleaved state changes

Check for deadlocks:
1. Circular await dependencies
2. Locks acquired in different orders

PROOF REQUIRED: Show the async call without await, or show two concurrent paths that can corrupt shared state.`,

  'auth-bypass': `AUTHENTICATION/AUTHORIZATION ANALYSIS FOCUS:

For EACH route/endpoint:
1. Is authentication required? Is middleware applied?
2. Is authorization checked? (user can only access their own data)
3. Are there any early returns that bypass auth?

Check for:
- Routes missing auth middleware
- Auth check that catches errors and continues
- IDOR: user ID from request used without ownership check
- Role checks that can be bypassed
- JWT/session validation that accepts expired tokens
- Password comparison using timing-unsafe methods

PROOF REQUIRED: Show the route definition missing auth, or the auth check that can be bypassed.`,

  'data-validation': `DATA VALIDATION ANALYSIS FOCUS:

For EACH external input (API request, file, env var):
1. Is there schema validation (Zod, Joi, etc.)?
2. Are individual fields validated for type and format?
3. Are numbers checked for NaN, Infinity, negative?
4. Are strings checked for length, format, encoding?
5. Are arrays checked for length limits?

Check for:
- JSON.parse without try/catch
- parseInt/parseFloat without NaN check
- Array access without length check
- Regex without timeout (ReDoS)
- Date parsing without validation

PROOF REQUIRED: Show the input field and the operation that assumes valid data.`,

  'logic-error': `LOGIC ERROR ANALYSIS FOCUS:

Check ALL conditionals:
1. Are operators correct? (= vs ==, & vs &&, | vs ||)
2. Are comparisons correct? (< vs <=, > vs >=)
3. Is the logic inverted? (if(!valid) vs if(valid))
4. Are all cases covered? (else clause, default in switch)

Check ALL loops:
1. Off-by-one errors (< vs <=, i vs i-1)
2. Infinite loop conditions
3. Break/continue in wrong place
4. Loop variable modified inside loop

Check ALL math:
1. Division by zero possibility
2. Integer overflow
3. Floating point precision issues
4. Order of operations

PROOF REQUIRED: Show the exact wrong operator or condition and what the correct one should be.`,

  'secrets-exposure': `SECRETS EXPOSURE ANALYSIS FOCUS:

Search for hardcoded secrets:
1. API keys, tokens (sk-, pk-, api_, secret_, token_)
2. Passwords, credentials (password, passwd, pwd, secret)
3. Private keys, certificates
4. Database connection strings with credentials

Check for secrets in logs:
1. console.log/error with request/response objects
2. Error messages that include credentials
3. Debug mode exposing sensitive data

Check for secrets in responses:
1. User objects returned with password hash
2. Config endpoints exposing secrets
3. Error responses with stack traces

PROOF REQUIRED: Show the exact line with the hardcoded secret or log statement.`,

  'boundary-error': `BOUNDARY ERROR ANALYSIS FOCUS:

Check ALL array/string operations:
1. Index access: is index always in bounds?
2. Slice/substring: are start/end valid?
3. Loop bounds: off-by-one errors?

Check ALL numeric operations:
1. Can denominator be zero?
2. Can result overflow?
3. Are negative numbers handled?

Check size limits:
1. File uploads without size limit
2. Arrays that can grow unbounded
3. Strings without length validation
4. Recursion without depth limit

PROOF REQUIRED: Show the operation and an input that causes out-of-bounds access or overflow.`,

  'type-coercion': `TYPE COERCION ANALYSIS FOCUS:

Check for JavaScript type coercion bugs:
1. == instead of === (0 == false, "" == false, null == undefined)
2. if (value) when 0 or "" are valid values
3. + with mixed types (string concatenation vs addition)
4. Array methods on non-arrays

Check for TypeScript false confidence:
1. as assertions that could be wrong at runtime
2. any type hiding actual types
3. Type guards that don't actually narrow

Check JSON operations:
1. JSON.parse result used without type check
2. API responses assumed to match TypeScript types

PROOF REQUIRED: Show the exact coercion and what unexpected value triggers wrong behavior.`,

  'concurrency': `CONCURRENCY ANALYSIS FOCUS:

Check shared state access:
1. Global variables modified by multiple requests
2. Class instance state modified concurrently
3. Database records updated without transactions

Check for atomicity issues:
1. Read-modify-write without locking
2. Check-then-act patterns (if exists, then update)
3. Counter increments without atomic operations

Check for deadlocks:
1. Multiple locks acquired in different orders
2. Nested transactions
3. Circular dependencies in async operations

PROOF REQUIRED: Show two concurrent operations that can corrupt shared state.`,

  'intent-violation': `INTENT VIOLATION ANALYSIS FOCUS:

Check for code that contradicts its documentation:
1. Function does opposite of what name suggests
2. Comment describes different behavior than code
3. Return type doesn't match actual returns

Check for misleading patterns:
1. Validation function that doesn't validate
2. Error handler that ignores errors
3. Security check that always passes
4. Cleanup function that doesn't clean up

PROOF REQUIRED: Show the documentation/name and the contradicting implementation.`,
};

/**
 * Get category-specific instructions for focused analysis
 */
export function getCategoryInstructions(category: string): string {
  return CATEGORY_SPECIFIC_INSTRUCTIONS[category] || '';
}
