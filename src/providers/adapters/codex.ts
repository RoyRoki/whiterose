/**
 * OpenAI Codex CLI Provider
 *
 * Uses the OpenAI Codex CLI (`codex exec`) for non-interactive code analysis.
 * Similar to how we wrap claude-code and aider.
 *
 * Configuration:
 * - Codex CLI must be installed: npm install -g @openai/codex
 * - Authentication via `codex auth` or CODEX_API_KEY environment variable
 *
 * @see https://developers.openai.com/codex/cli/
 * @see https://developers.openai.com/codex/noninteractive/
 */

import { execa } from 'execa';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
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
import { isProviderAvailable, getProviderCommand } from '../detect.js';
import { generateBugId } from '../../core/utils.js';

const MAX_FILE_SIZE = 50000;
const MAX_TOTAL_CONTEXT = 200000;
const CODEX_TIMEOUT = 300000; // 5 minutes

type ProgressCallback = (message: string) => void;

export class CodexProvider implements LLMProvider {
  name: ProviderType = 'codex';
  private progressCallback?: ProgressCallback;

  async detect(): Promise<boolean> {
    return isProviderAvailable('codex');
  }

  async isAvailable(): Promise<boolean> {
    return isProviderAvailable('codex');
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  private reportProgress(message: string): void {
    if (this.progressCallback) {
      this.progressCallback(message);
    }
  }

  async analyze(context: AnalysisContext): Promise<Bug[]> {
    const { files, understanding, staticAnalysisResults } = context;

    if (files.length === 0) {
      return [];
    }

    this.reportProgress(`Analyzing ${files.length} files with Codex...`);

    // Read file contents with size limits
    const fileContents = this.readFilesWithLimit(files, MAX_TOTAL_CONTEXT);

    // Build the analysis prompt
    const prompt = this.buildAnalysisPrompt(fileContents, understanding, staticAnalysisResults || []);

    // Run codex with the prompt
    const result = await this.runCodex(prompt, dirname(files[0]));

    // Parse the response into bugs
    return this.parseAnalysisResponse(result, files);
  }

  async adversarialValidate(bug: Bug, _context: AnalysisContext): Promise<AdversarialResult> {
    let fileContent = '';
    try {
      if (existsSync(bug.file)) {
        fileContent = readFileSync(bug.file, 'utf-8');
        const lines = fileContent.split('\n');
        const start = Math.max(0, bug.line - 20);
        const end = Math.min(lines.length, (bug.endLine || bug.line) + 20);
        fileContent = lines.slice(start, end).join('\n');
      }
    } catch {
      // Continue without content
    }

    const prompt = this.buildAdversarialPrompt(bug, fileContent);
    const result = await this.runCodex(prompt, dirname(bug.file));

    return this.parseAdversarialResponse(result, bug);
  }

  async generateUnderstanding(files: string[], _existingDocsSummary?: string): Promise<CodebaseUnderstanding> {
    const sampledFiles = this.prioritizeFiles(files, 40);
    const fileContents = this.readFilesWithLimit(sampledFiles, MAX_TOTAL_CONTEXT);

    let packageJson: Record<string, unknown> | null = null;
    const packageJsonPath = files.find((f) => f.endsWith('package.json'));
    if (packageJsonPath) {
      try {
        packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      } catch {
        // Ignore
      }
    }

    const prompt = this.buildUnderstandingPrompt(files.length, fileContents, packageJson);
    const result = await this.runCodex(prompt, process.cwd());

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

        if (content.length > MAX_FILE_SIZE) {
          content = content.slice(0, MAX_FILE_SIZE) + '\n// ... truncated ...';
        }

        if (totalSize + content.length > maxTotal) {
          const remaining = maxTotal - totalSize;
          content = content.slice(0, remaining) + '\n// ... truncated ...';
        }

        result.push({ path: file, content });
        totalSize += content.length;
      } catch {
        // Skip
      }
    }

    return result;
  }

  private prioritizeFiles(files: string[], count: number): string[] {
    if (files.length <= count) return files;

    const priorityPatterns: Array<{ pattern: RegExp; priority: number }> = [
      { pattern: /package\.json$/, priority: 100 },
      { pattern: /tsconfig\.json$/, priority: 90 },
      { pattern: /README\.md$/i, priority: 80 },
      { pattern: /\/index\.(ts|js|tsx|jsx)$/, priority: 70 },
      { pattern: /\/app\.(ts|js|tsx|jsx)$/, priority: 70 },
      { pattern: /\/main\.(ts|js|tsx|jsx)$/, priority: 70 },
      { pattern: /\/api\//, priority: 60 },
      { pattern: /\/routes?\//, priority: 55 },
      { pattern: /\/pages\//, priority: 55 },
      { pattern: /\/services?\//, priority: 50 },
      { pattern: /\.(ts|tsx)$/, priority: 30 },
      { pattern: /\.(js|jsx)$/, priority: 20 },
    ];

    const scored = files.map((file) => {
      let score = 0;
      for (const { pattern, priority } of priorityPatterns) {
        if (pattern.test(file)) {
          score = Math.max(score, priority);
        }
      }
      return { file, score };
    });

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
        ? `\nStatic analysis signals:\n${staticResults
            .slice(0, 50)
            .map((r) => `- ${r.file}:${r.line}: ${r.message}`)
            .join('\n')}`
        : '';

    return `You are a security auditor and bug hunter. Analyze the following code for bugs.

This is a ${understanding.summary.type} application using ${understanding.summary.framework || 'no specific framework'}.

${filesSection}
${staticSignals}

Find bugs in these categories:
1. Logic errors (off-by-one, wrong operators, incorrect conditions)
2. Null/undefined dereference
3. Security vulnerabilities (injection, auth bypass, data exposure)
4. Async/race conditions
5. Resource leaks
6. Edge cases not handled

IMPORTANT: Output ONLY a JSON array with no other text:
[{"file": "path/to/file.ts", "line": 42, "title": "Bug title", "description": "Detailed description", "severity": "critical|high|medium|low", "category": "null-reference|logic-error|injection|auth-bypass|async-issue|resource-leak", "codePath": [{"step": 1, "file": "path", "line": 40, "code": "code snippet", "explanation": "explanation"}], "evidence": ["evidence1", "evidence2"], "suggestedFix": "fix suggestion"}]

If no bugs found, return: []`;
  }

  private buildAdversarialPrompt(bug: Bug, fileContent: string): string {
    return `You are a skeptical code reviewer. Challenge this bug report and determine if it's a real bug or a false positive.

BUG REPORT:
- Title: ${bug.title}
- Description: ${bug.description}
- File: ${bug.file}:${bug.line}
- Severity: ${bug.severity}
- Category: ${bug.category}

Code context:
${fileContent}

Find reasons this is NOT a bug:
- Are there guards or type checks that prevent this issue?
- Is the code path actually reachable?
- Are there runtime checks we might have missed?

Output ONLY JSON with no other text:
{"survived": true, "counterArguments": ["reason1", "reason2"], "confidence": "high|medium|low"}

Set "survived" to true if the bug is real, false if it's likely a false positive.`;
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
      ? `\nDependencies: ${JSON.stringify((packageJson as any).dependencies || {})}`
      : '';

    return `Analyze this codebase (${totalFiles} total files) and provide a structured understanding.
${depsSection}

${filesSection}

Output ONLY JSON with no other text:
{
  "summary": {"type": "web-app|api|library|cli", "framework": "react|express|etc", "language": "typescript|javascript", "description": "brief description"},
  "features": [{"name": "Feature", "description": "desc", "priority": "critical|high|medium|low", "constraints": ["constraint"], "relatedFiles": ["file"]}],
  "contracts": [{"name": "Contract", "description": "what it guarantees", "type": "invariant|precondition|postcondition", "enforcementLevel": "critical|important|nice-to-have"}],
  "dependencies": {"package": "version"}
}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Codex CLI Execution
  // ─────────────────────────────────────────────────────────────

  private async runCodex(prompt: string, cwd: string): Promise<string> {
    // Create a temp directory for output
    const tempDir = mkdtempSync(join(tmpdir(), 'whiterose-codex-'));
    const outputFile = join(tempDir, 'output.txt');

    try {
      // Use codex exec for non-interactive mode
      // Pipe prompt via stdin with '-' argument
      const codexCommand = getProviderCommand('codex');

      const args = [
        'exec',
        '--skip-git-repo-check', // We handle our own safety checks
        '-o', outputFile, // Write final message to file
        '-', // Read prompt from stdin
      ];

      this.reportProgress('Running Codex analysis...');

      const { stdout, stderr } = await execa(codexCommand, args, {
        cwd,
        input: prompt,
        timeout: CODEX_TIMEOUT,
        env: {
          ...process.env,
          NO_COLOR: '1',
        },
        reject: false,
      });

      // Try to read from output file first
      if (existsSync(outputFile)) {
        try {
          return readFileSync(outputFile, 'utf-8');
        } catch {
          // Fall through to stdout
        }
      }

      return stdout || stderr || '';
    } catch (error: any) {
      if (error.stdout) {
        return error.stdout;
      }

      if (error.message?.includes('ENOENT')) {
        throw new Error('Codex not found. Install it with: npm install -g @openai/codex');
      }

      throw new Error(`Codex failed: ${error.message}`);
    } finally {
      // Clean up temp files
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Response Parsers
  // ─────────────────────────────────────────────────────────────

  private parseAnalysisResponse(response: string, files: string[]): Bug[] {
    try {
      const json = this.extractJson(response);
      if (!json) return [];

      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];

      const bugs: Bug[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item.file || !item.line || !item.title) continue;

        let filePath = item.file;
        if (!filePath.startsWith('/')) {
          const match = files.find((f) => f.endsWith(filePath) || f.includes(filePath));
          if (match) filePath = match;
        }

        const codePath: CodePathStep[] = (item.codePath || []).map(
          (step: any, idx: number) => ({
            step: step.step || idx + 1,
            file: step.file || filePath,
            line: step.line || item.line,
            code: step.code || '',
            explanation: step.explanation || '',
          })
        );

        bugs.push({
          id: generateBugId(i),
          title: String(item.title).slice(0, 100),
          description: String(item.description || ''),
          file: filePath,
          line: Number(item.line) || 0,
          endLine: item.endLine ? Number(item.endLine) : undefined,
          kind: 'bug',
          severity: this.parseSeverity(item.severity),
          category: this.parseCategory(item.category),
          confidence: {
            overall: 'medium' as ConfidenceLevel,
            codePathValidity: 0.75,
            reachability: 0.75,
            intentViolation: false,
            staticToolSignal: false,
            adversarialSurvived: false,
          },
          codePath,
          evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [],
          suggestedFix: item.suggestedFix ? String(item.suggestedFix) : undefined,
          createdAt: new Date().toISOString(),
          status: 'open',
        });
      }

      return bugs;
    } catch {
      return [];
    }
  }

  private parseAdversarialResponse(response: string, bug: Bug): AdversarialResult {
    try {
      const json = this.extractJson(response);
      if (!json) return { survived: true, counterArguments: [] };

      const parsed = JSON.parse(json);
      const survived = parsed.survived !== false;

      return {
        survived,
        counterArguments: Array.isArray(parsed.counterArguments)
          ? parsed.counterArguments.map(String)
          : [],
        adjustedConfidence: survived
          ? {
              ...bug.confidence,
              overall: this.parseConfidence(parsed.confidence),
              adversarialSurvived: true,
            }
          : undefined,
      };
    } catch {
      return { survived: true, counterArguments: [] };
    }
  }

  private parseUnderstandingResponse(response: string, files: string[]): CodebaseUnderstanding {
    try {
      const json = this.extractJson(response);
      if (!json) throw new Error('No JSON found');

      const parsed = JSON.parse(json);

      return {
        version: '1',
        generatedAt: new Date().toISOString(),
        summary: {
          type: parsed.summary?.type || 'unknown',
          description: parsed.summary?.description || '',
          language: parsed.summary?.language || 'unknown',
          framework: parsed.summary?.framework,
        },
        features: parsed.features || [],
        contracts: parsed.contracts || [],
        dependencies: parsed.dependencies || {},
        structure: {
          totalFiles: files.length,
          totalLines: 0,
          packages: [],
        },
      };
    } catch {
      // Return minimal understanding on parse failure
      return {
        version: '1',
        generatedAt: new Date().toISOString(),
        summary: {
          type: 'unknown',
          description: 'Failed to parse Codex response',
          language: 'unknown',
        },
        features: [],
        contracts: [],
        dependencies: {},
        structure: {
          totalFiles: files.length,
          totalLines: 0,
          packages: [],
        },
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Utility Methods
  // ─────────────────────────────────────────────────────────────

  private extractJson(text: string): string | null {
    // Try to find JSON array or object in the response
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) return arrayMatch[0];

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) return objectMatch[0];

    return null;
  }

  private parseSeverity(value: any): BugSeverity {
    const v = String(value).toLowerCase();
    if (v === 'critical') return 'critical';
    if (v === 'high') return 'high';
    if (v === 'medium') return 'medium';
    return 'low';
  }

  private parseCategory(value: any): BugCategory {
    const v = String(value).toLowerCase().replace(/[^a-z-]/g, '');
    const validCategories: BugCategory[] = [
      'injection',
      'auth-bypass',
      'secrets-exposure',
      'null-reference',
      'boundary-error',
      'resource-leak',
      'async-issue',
      'logic-error',
      'data-validation',
      'type-coercion',
      'concurrency',
      'intent-violation',
    ];
    return validCategories.includes(v as BugCategory) ? (v as BugCategory) : 'logic-error';
  }

  private parseConfidence(value: any): ConfidenceLevel {
    const v = String(value).toLowerCase();
    if (v === 'high') return 'high';
    if (v === 'low') return 'low';
    return 'medium';
  }
}
