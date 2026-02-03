import { execa } from 'execa';
import { readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import {
  LLMProvider,
  ProviderType,
  AnalysisContext,
  Bug,
  AdversarialResult,
  CodebaseUnderstanding,
  BugSeverity,
  BugCategory,
  ConfidenceLevel,
  CodePathStep,
} from '../../types.js';
import { isProviderAvailable } from '../detect.js';
import { generateBugId } from '../../core/utils.js';

const MAX_FILE_SIZE = 50000; // 50KB max per file
const MAX_TOTAL_CONTEXT = 200000; // 200KB total context
const ANALYSIS_TIMEOUT = 300000; // 5 minutes

export class ClaudeCodeProvider implements LLMProvider {
  name: ProviderType = 'claude-code';

  async detect(): Promise<boolean> {
    return isProviderAvailable('claude-code');
  }

  async isAvailable(): Promise<boolean> {
    return isProviderAvailable('claude-code');
  }

  async analyze(context: AnalysisContext): Promise<Bug[]> {
    const { files, understanding, staticAnalysisResults } = context;

    if (files.length === 0) {
      return [];
    }

    // Read file contents with size limits
    const fileContents = this.readFilesWithLimit(files, MAX_TOTAL_CONTEXT);

    // Build the analysis prompt
    const prompt = this.buildAnalysisPrompt(fileContents, understanding, staticAnalysisResults);

    // Get the working directory (use first file's directory or cwd)
    const cwd = files[0] ? dirname(files[0]) : process.cwd();

    // Run claude with the prompt
    const result = await this.runClaude(prompt, cwd);

    // Parse the response into bugs
    return this.parseAnalysisResponse(result, files);
  }

  async adversarialValidate(bug: Bug, _context: AnalysisContext): Promise<AdversarialResult> {
    // Read the file containing the bug for context
    let fileContent = '';
    try {
      if (existsSync(bug.file)) {
        fileContent = readFileSync(bug.file, 'utf-8');
        // Get relevant lines around the bug
        const lines = fileContent.split('\n');
        const start = Math.max(0, bug.line - 20);
        const end = Math.min(lines.length, (bug.endLine || bug.line) + 20);
        fileContent = lines.slice(start, end).join('\n');
      }
    } catch {
      // File read failed, continue without content
    }

    const prompt = this.buildAdversarialPrompt(bug, fileContent);
    const result = await this.runClaude(prompt, process.cwd());

    return this.parseAdversarialResponse(result, bug);
  }

  async generateUnderstanding(files: string[]): Promise<CodebaseUnderstanding> {
    // Prioritize and sample key files
    const sampledFiles = this.prioritizeFiles(files, 40);

    // Read file contents
    const fileContents = this.readFilesWithLimit(sampledFiles, MAX_TOTAL_CONTEXT);

    // Also try to read package.json for dependencies
    let packageJson: Record<string, unknown> | null = null;
    const packageJsonPath = files.find((f) => f.endsWith('package.json'));
    if (packageJsonPath) {
      try {
        packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      } catch {
        // Ignore parse errors
      }
    }

    const prompt = this.buildUnderstandingPrompt(files.length, fileContents, packageJson);
    const result = await this.runClaude(prompt, process.cwd());

    return this.parseUnderstandingResponse(result, files);
  }

  // ─────────────────────────────────────────────────────────────
  // File Reading Helpers
  // ─────────────────────────────────────────────────────────────

  private readFilesWithLimit(
    files: string[],
    maxTotal: number
  ): Array<{ path: string; content: string }> {
    const result: Array<{ path: string; content: string }> = [];
    let totalSize = 0;

    for (const file of files) {
      if (totalSize >= maxTotal) break;

      try {
        if (!existsSync(file)) continue;

        let content = readFileSync(file, 'utf-8');

        // Truncate large files
        if (content.length > MAX_FILE_SIZE) {
          content = content.slice(0, MAX_FILE_SIZE) + '\n// ... truncated ...';
        }

        // Check if adding this file exceeds limit
        if (totalSize + content.length > maxTotal) {
          // Add partial content
          const remaining = maxTotal - totalSize;
          content = content.slice(0, remaining) + '\n// ... truncated ...';
        }

        result.push({ path: file, content });
        totalSize += content.length;
      } catch {
        // Skip files that can't be read
      }
    }

    return result;
  }

  private prioritizeFiles(files: string[], count: number): string[] {
    if (files.length <= count) return files;

    // Priority patterns (higher = more important)
    const priorityPatterns: Array<{ pattern: RegExp; priority: number }> = [
      { pattern: /package\.json$/, priority: 100 },
      { pattern: /tsconfig\.json$/, priority: 90 },
      { pattern: /README\.md$/i, priority: 80 },
      { pattern: /\/index\.(ts|js|tsx|jsx)$/, priority: 70 },
      { pattern: /\/app\.(ts|js|tsx|jsx)$/, priority: 70 },
      { pattern: /\/main\.(ts|js|tsx|jsx)$/, priority: 70 },
      { pattern: /\/server\.(ts|js|tsx|jsx)$/, priority: 65 },
      { pattern: /\/api\//, priority: 60 },
      { pattern: /\/routes?\//, priority: 55 },
      { pattern: /\/pages\//, priority: 55 },
      { pattern: /\/components\//, priority: 50 },
      { pattern: /\/hooks\//, priority: 45 },
      { pattern: /\/utils?\//, priority: 40 },
      { pattern: /\/lib\//, priority: 40 },
      { pattern: /\/services?\//, priority: 50 },
      { pattern: /\/models?\//, priority: 45 },
      { pattern: /\/controllers?\//, priority: 50 },
      { pattern: /\.(ts|tsx)$/, priority: 30 },
      { pattern: /\.(js|jsx)$/, priority: 20 },
    ];

    // Score each file
    const scored = files.map((file) => {
      let score = 0;
      for (const { pattern, priority } of priorityPatterns) {
        if (pattern.test(file)) {
          score = Math.max(score, priority);
        }
      }
      return { file, score };
    });

    // Sort by score descending, then take top N
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, count).map((s) => s.file);
  }

  // ─────────────────────────────────────────────────────────────
  // Prompt Builders
  // ─────────────────────────────────────────────────────────────

  private buildAnalysisPrompt(
    fileContents: Array<{ path: string; content: string }>,
    understanding: CodebaseUnderstanding,
    staticResults: Array<{ tool: string; file: string; line: number; message: string }>
  ): string {
    const filesSection = fileContents
      .map((f) => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    const staticSignals =
      staticResults.length > 0
        ? `\n\nStatic analysis signals (from tsc/eslint):\n${staticResults
            .slice(0, 50)
            .map((r) => `- ${r.file}:${r.line} [${r.tool}]: ${r.message}`)
            .join('\n')}`
        : '';

    const contractsSection =
      understanding.contracts.length > 0
        ? `\n\nBehavioral contracts to validate:\n${understanding.contracts
            .slice(0, 15)
            .map((c) => `- ${c.function}(): ${c.invariants.slice(0, 3).join(', ')}`)
            .join('\n')}`
        : '';

    return `You are whiterose, an expert bug hunter. Analyze the following code for bugs.

CODEBASE CONTEXT:
- Type: ${understanding.summary.type}
- Framework: ${understanding.summary.framework || 'Unknown'}
- Description: ${understanding.summary.description}
${contractsSection}
${staticSignals}

FILES TO ANALYZE:
${filesSection}

FIND BUGS IN THESE CATEGORIES:
1. Logic errors (off-by-one, wrong operators, incorrect conditions, infinite loops)
2. Null/undefined dereference (accessing properties on potentially null values)
3. Security vulnerabilities (injection, auth bypass, data exposure, XSS, CSRF)
4. Async/race conditions (missing await, unhandled promises, race conditions)
5. Edge cases (empty arrays, zero values, boundary conditions)
6. Resource leaks (unclosed connections, event listener leaks)
7. Type coercion bugs (loose equality, implicit conversions)

FOR EACH BUG, PROVIDE:
1. The exact file path and line number
2. A brief title (max 60 chars)
3. Detailed description of what's wrong
4. Severity: critical (crash/security), high (data loss/corruption), medium (incorrect behavior), low (minor issue)
5. Category from the list above
6. Code path: Step-by-step trace showing how the bug triggers
7. Evidence: Specific code references proving this is a bug
8. Suggested fix: Code snippet showing the fix

BE PRECISE:
- Only report bugs you have HIGH confidence in
- Include exact line numbers
- Show the actual code path that triggers the bug
- Don't report style issues or minor refactoring suggestions

OUTPUT AS JSON (and nothing else):
[
  {
    "file": "src/api/users.ts",
    "line": 42,
    "endLine": 45,
    "title": "Null dereference in getUserById",
    "description": "The function returns user.name without checking if user is null. When db.find() returns null for non-existent users, this will throw a TypeError.",
    "severity": "high",
    "category": "null-reference",
    "codePath": [
      {"step": 1, "file": "src/api/users.ts", "line": 38, "code": "const user = await db.find(id)", "explanation": "db.find returns null when user not found"},
      {"step": 2, "file": "src/api/users.ts", "line": 42, "code": "return user.name", "explanation": "Dereference without null check causes TypeError"}
    ],
    "evidence": ["Line 42 accesses user.name without null check", "db.find() is documented to return null when not found"],
    "suggestedFix": "if (!user) return null;\\nreturn user.name;"
  }
]

If no bugs are found, return an empty array: []`;
  }

  private buildAdversarialPrompt(bug: Bug, fileContent: string): string {
    return `You are a skeptical code reviewer. Your job is to DISPROVE the following bug report.

REPORTED BUG:
- File: ${bug.file}:${bug.line}
- Title: ${bug.title}
- Description: ${bug.description}
- Severity: ${bug.severity}
- Category: ${bug.category}
- Evidence: ${bug.evidence.join('; ')}

CODE CONTEXT:
${fileContent}

CODE PATH CLAIMED:
${bug.codePath.map((s) => `${s.step}. ${s.file}:${s.line} - ${s.explanation}`).join('\n')}

YOUR TASK:
Try to prove this is NOT a bug by finding:
1. Guards, checks, or validation that prevents this issue
2. Type system guarantees (TypeScript types that make this impossible)
3. Framework/library behavior that handles this case
4. Unreachable code paths (conditions that can never be true)
5. Invariants established earlier in the code
6. Any other reason this isn't actually exploitable

BE THOROUGH:
- Check for try/catch blocks
- Check for optional chaining (?.)
- Check for nullish coalescing (??)
- Check for type guards
- Check for early returns
- Check framework conventions

OUTPUT AS JSON (and nothing else):
{
  "survived": true/false,
  "counterArguments": ["reason 1", "reason 2"],
  "confidence": "high/medium/low",
  "explanation": "Brief explanation of why this is or isn't a real bug"
}

Set "survived": true if you CANNOT disprove the bug (it's real).
Set "survived": false if you found valid reasons it's not a bug.`;
  }

  private buildUnderstandingPrompt(
    totalFiles: number,
    fileContents: Array<{ path: string; content: string }>,
    packageJson: Record<string, unknown> | null
  ): string {
    const filesSection = fileContents
      .map((f) => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    const depsSection = packageJson
      ? `\nDEPENDENCIES (from package.json):\n${JSON.stringify(
          {
            dependencies: (packageJson as any).dependencies || {},
            devDependencies: (packageJson as any).devDependencies || {},
          },
          null,
          2
        )}`
      : '';

    return `Analyze this codebase to understand its structure, purpose, and key behaviors.

CODEBASE STATS:
- Total files: ${totalFiles}
- Sample files shown: ${fileContents.length}
${depsSection}

SAMPLE FILES:
${filesSection}

ANALYZE AND PROVIDE:

1. SUMMARY: What is this application?
   - type: What kind of app? (e-commerce, saas, api, cli, library, mobile-app, etc.)
   - framework: Primary framework (next.js, express, fastify, react, vue, etc.)
   - language: Primary language (typescript, javascript)
   - description: 2-3 sentence description of what this app does

2. FEATURES: List the main features/modules (max 10)
   For each feature:
   - name: Feature name
   - description: What it does
   - priority: critical/high/medium/low (based on business importance)
   - constraints: Business rules that must be maintained (max 5)
   - relatedFiles: Key files for this feature (max 5)

3. BEHAVIORAL CONTRACTS: For important functions (max 15)
   For each contract:
   - function: Function name
   - file: File path
   - inputs: Array of {name, type, constraints?}
   - outputs: {type, constraints?}
   - invariants: Rules that must always be true (max 5)
   - sideEffects: What this function changes (database, files, etc.)
   - throws: Exceptions this can throw

OUTPUT AS JSON (and nothing else):
{
  "summary": {
    "type": "e-commerce",
    "framework": "next.js",
    "language": "typescript",
    "description": "An online store for selling widgets with cart, checkout, and user accounts."
  },
  "features": [
    {
      "name": "Checkout",
      "description": "Handles cart to order conversion and payment processing",
      "priority": "critical",
      "constraints": ["Must not double-charge", "Must validate inventory before purchase"],
      "relatedFiles": ["src/api/checkout.ts", "src/services/payment.ts"]
    }
  ],
  "contracts": [
    {
      "function": "processPayment",
      "file": "src/services/payment.ts",
      "inputs": [{"name": "orderId", "type": "string"}, {"name": "amount", "type": "number", "constraints": "positive integer, cents"}],
      "outputs": {"type": "PaymentResult", "constraints": "success or specific error"},
      "invariants": ["Must create order record before charging", "Must rollback on failure"],
      "sideEffects": ["Creates payment record", "Updates order status"],
      "throws": ["PaymentDeclinedError", "InsufficientFundsError"]
    }
  ]
}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Claude CLI Execution
  // ─────────────────────────────────────────────────────────────

  private async runClaude(prompt: string, cwd: string): Promise<string> {
    try {
      // Use claude CLI with print mode for non-interactive output
      const { stdout } = await execa(
        'claude',
        [
          '-p', prompt,
          '--output-format', 'text',
          '--verbose',
        ],
        {
          cwd,
          timeout: ANALYSIS_TIMEOUT,
          env: {
            ...process.env,
            // Ensure we get clean output
            NO_COLOR: '1',
          },
        }
      );

      return stdout;
    } catch (error: any) {
      // If claude exits with error but has stdout, use it
      if (error.stdout && error.stdout.length > 0) {
        return error.stdout;
      }

      // Check for common errors
      if (error.message?.includes('ENOENT')) {
        throw new Error('Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code');
      }

      if (error.message?.includes('timeout')) {
        throw new Error('Claude CLI timed out. Try scanning fewer files.');
      }

      throw new Error(`Claude CLI failed: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Response Parsers
  // ─────────────────────────────────────────────────────────────

  private parseAnalysisResponse(response: string, files: string[]): Bug[] {
    try {
      // Extract JSON from the response (handle markdown code blocks)
      const json = this.extractJson(response);
      if (!json) {
        console.error('No JSON found in analysis response');
        return [];
      }

      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        console.error('Analysis response is not an array');
        return [];
      }

      const bugs: Bug[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];

        // Validate required fields
        if (!item.file || !item.line || !item.title) {
          continue;
        }

        // Resolve relative paths
        let filePath = item.file;
        if (!filePath.startsWith('/')) {
          // Try to find matching file from our list
          const match = files.find(
            (f) => f.endsWith(filePath) || f.includes(filePath)
          );
          if (match) {
            filePath = match;
          }
        }

        // Parse code path
        const codePath: CodePathStep[] = (item.codePath || []).map(
          (step: any, idx: number) => ({
            step: step.step || idx + 1,
            file: step.file || filePath,
            line: step.line || item.line,
            code: step.code || '',
            explanation: step.explanation || '',
          })
        );

        const bug: Bug = {
          id: generateBugId(i),
          title: String(item.title).slice(0, 100),
          description: String(item.description || ''),
          file: filePath,
          line: Number(item.line) || 0,
          endLine: item.endLine ? Number(item.endLine) : undefined,
          severity: this.parseSeverity(item.severity),
          category: this.parseCategory(item.category),
          confidence: {
            overall: 'medium' as ConfidenceLevel,
            codePathValidity: 0.8,
            reachability: 0.8,
            intentViolation: false,
            staticToolSignal: false,
            adversarialSurvived: false,
          },
          codePath,
          evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [],
          suggestedFix: item.suggestedFix ? String(item.suggestedFix) : undefined,
          createdAt: new Date().toISOString(),
        };

        bugs.push(bug);
      }

      return bugs;
    } catch (error) {
      console.error('Failed to parse analysis response:', error);
      return [];
    }
  }

  private parseAdversarialResponse(response: string, bug: Bug): AdversarialResult {
    try {
      const json = this.extractJson(response);
      if (!json) {
        // If no JSON, assume bug survived (conservative)
        return { survived: true, counterArguments: [] };
      }

      const parsed = JSON.parse(json);

      const survived = parsed.survived !== false;
      const confidence = this.parseConfidence(parsed.confidence);

      return {
        survived,
        counterArguments: Array.isArray(parsed.counterArguments)
          ? parsed.counterArguments.map(String)
          : [],
        adjustedConfidence: survived
          ? {
              ...bug.confidence,
              overall: confidence,
              adversarialSurvived: true,
            }
          : undefined,
      };
    } catch {
      // On parse error, assume bug survived (conservative)
      return { survived: true, counterArguments: [] };
    }
  }

  private parseUnderstandingResponse(
    response: string,
    files: string[]
  ): CodebaseUnderstanding {
    try {
      const json = this.extractJson(response);
      if (!json) {
        throw new Error('No JSON found in understanding response');
      }

      const parsed = JSON.parse(json);

      // Count total lines
      let totalLines = 0;
      for (const file of files.slice(0, 100)) {
        try {
          const content = readFileSync(file, 'utf-8');
          totalLines += content.split('\n').length;
        } catch {
          // Skip unreadable files
        }
      }

      return {
        version: '1',
        generatedAt: new Date().toISOString(),
        summary: {
          type: parsed.summary?.type || 'unknown',
          framework: parsed.summary?.framework || undefined,
          language: parsed.summary?.language || 'typescript',
          description: parsed.summary?.description || 'No description available',
        },
        features: (parsed.features || []).map((f: any) => ({
          name: f.name || 'Unknown',
          description: f.description || '',
          priority: f.priority || 'medium',
          constraints: Array.isArray(f.constraints) ? f.constraints : [],
          relatedFiles: Array.isArray(f.relatedFiles) ? f.relatedFiles : [],
        })),
        contracts: (parsed.contracts || []).map((c: any) => ({
          function: c.function || 'unknown',
          file: c.file || 'unknown',
          inputs: Array.isArray(c.inputs) ? c.inputs : [],
          outputs: c.outputs || { type: 'unknown' },
          invariants: Array.isArray(c.invariants) ? c.invariants : [],
          sideEffects: Array.isArray(c.sideEffects) ? c.sideEffects : [],
          throws: Array.isArray(c.throws) ? c.throws : undefined,
        })),
        dependencies: {},
        structure: {
          totalFiles: files.length,
          totalLines,
        },
      };
    } catch (error) {
      console.error('Failed to parse understanding response:', error);

      // Return minimal understanding on failure
      return {
        version: '1',
        generatedAt: new Date().toISOString(),
        summary: {
          type: 'unknown',
          language: 'typescript',
          description: 'Failed to analyze codebase. Please run whiterose refresh.',
        },
        features: [],
        contracts: [],
        dependencies: {},
        structure: {
          totalFiles: files.length,
          totalLines: 0,
        },
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Utility Methods
  // ─────────────────────────────────────────────────────────────

  private extractJson(text: string): string | null {
    // Try to find JSON in markdown code blocks first
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to find raw JSON array
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return arrayMatch[0];
    }

    // Try to find raw JSON object
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return null;
  }

  private parseSeverity(value: unknown): BugSeverity {
    const str = String(value).toLowerCase();
    if (['critical', 'high', 'medium', 'low'].includes(str)) {
      return str as BugSeverity;
    }
    return 'medium';
  }

  private parseCategory(value: unknown): BugCategory {
    const str = String(value).toLowerCase().replace(/_/g, '-');
    const validCategories: BugCategory[] = [
      'logic-error',
      'security',
      'async-race-condition',
      'edge-case',
      'null-reference',
      'type-coercion',
      'resource-leak',
      'intent-violation',
    ];

    if (validCategories.includes(str as BugCategory)) {
      return str as BugCategory;
    }

    // Map common variations
    if (str.includes('null') || str.includes('undefined')) return 'null-reference';
    if (str.includes('security') || str.includes('injection') || str.includes('xss')) return 'security';
    if (str.includes('async') || str.includes('race') || str.includes('promise')) return 'async-race-condition';
    if (str.includes('edge') || str.includes('boundary')) return 'edge-case';
    if (str.includes('type') || str.includes('coercion')) return 'type-coercion';
    if (str.includes('leak') || str.includes('resource')) return 'resource-leak';

    return 'logic-error';
  }

  private parseConfidence(value: unknown): ConfidenceLevel {
    const str = String(value).toLowerCase();
    if (['high', 'medium', 'low'].includes(str)) {
      return str as ConfidenceLevel;
    }
    return 'medium';
  }
}
