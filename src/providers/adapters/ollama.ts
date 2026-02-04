/**
 * Ollama Provider (Local LLMs)
 *
 * Uses the Ollama API for local model inference.
 * Supports Code Llama, DeepSeek Coder, and other code-focused models.
 *
 * Configuration:
 * - Ollama must be running locally (default: http://localhost:11434)
 * - OLLAMA_HOST environment variable to override host
 * - Model can be configured (default: codellama)
 *
 * @see https://ollama.com/library
 * @see https://github.com/ollama/ollama-js
 */

import { Ollama } from 'ollama';
import { readFileSync } from 'fs';
import {
  LLMProvider,
  ProviderType,
  AnalysisContext,
  Bug,
  AdversarialResult,
  CodebaseUnderstanding,
  AnalyzeOptions,
} from '../../types.js';
import { generateBugId } from '../../core/utils.js';
import {
  PartialBugFromLLM,
  PartialUnderstandingFromLLM,
  AdversarialResultSchema,
} from '../../core/validation.js';

// Recommended models for code analysis
const MODELS = {
  analysis: 'deepseek-coder:6.7b', // Good balance of speed and quality
  quick: 'codellama:7b', // Faster for quick scans
  understanding: 'deepseek-coder:6.7b',
  alternatives: [
    'codellama:13b', // Larger, better quality
    'codellama:34b', // Best quality, requires more RAM
    'deepseek-coder:33b', // Best for complex analysis
    'qwen2.5-coder:7b', // Good alternative
  ],
};

type ProgressCallback = (message: string) => void;

export class OllamaProvider implements LLMProvider {
  name: ProviderType = 'ollama';
  private client: Ollama | null = null;
  private progressCallback?: ProgressCallback;
  private model: string;
  private host: string;

  constructor(model?: string, host?: string) {
    this.model = model || MODELS.analysis;
    this.host = host || process.env.OLLAMA_HOST || 'http://localhost:11434';
  }

  private getClient(): Ollama {
    if (!this.client) {
      this.client = new Ollama({ host: this.host });
    }
    return this.client;
  }

  async detect(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.list();
      return true;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      const models = await client.list();

      // Check if any code model is available
      const codeModels = models.models.filter(
        (m) =>
          m.name.includes('codellama') ||
          m.name.includes('deepseek') ||
          m.name.includes('coder') ||
          m.name.includes('qwen')
      );

      if (codeModels.length === 0) {
        console.warn(
          'No code-focused models found. Run: ollama pull deepseek-coder:6.7b'
        );
        // Fall back to any available model
        return models.models.length > 0;
      }

      // Use the first available code model
      if (!this.model || !models.models.find((m) => m.name === this.model)) {
        this.model = codeModels[0].name;
      }

      return true;
    } catch {
      return false;
    }
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  private reportProgress(message: string): void {
    if (this.progressCallback) {
      this.progressCallback(message);
    }
  }

  async analyze(
    context: AnalysisContext,
    options?: AnalyzeOptions
  ): Promise<Bug[]> {
    const bugs: Bug[] = [];
    const { files, understanding, staticAnalysisResults } = context;
    const isQuick = options?.quick ?? false;

    const client = this.getClient();

    this.reportProgress(
      `Analyzing ${files.length} files with Ollama (${this.model})...`
    );

    // Process files one at a time for local models (memory constraints)
    const batchSize = isQuick ? 3 : 1;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      this.reportProgress(
        `Processing file ${i + 1}/${files.length}: ${batch[0]}...`
      );

      // Read file contents
      const fileContents = batch.map((file) => {
        try {
          const content = readFileSync(file, 'utf-8');
          // Limit size more aggressively for local models
          return { file, content: content.slice(0, 5000) };
        } catch {
          return { file, content: '// Could not read file' };
        }
      });

      // Get static analysis signals for these files
      const signals = staticAnalysisResults.filter((s) =>
        batch.some((f) => f.endsWith(s.file) || s.file.endsWith(f))
      );

      // Build prompt - use simpler prompts for local models
      const prompt = this.buildLocalPrompt(
        fileContents,
        understanding,
        signals,
        isQuick
      );

      try {
        const response = await client.generate({
          model: this.model,
          prompt,
          format: 'json',
          options: {
            temperature: 0.2,
            num_predict: 2000, // Limit response length
          },
        });

        if (response.response) {
          const parsed = this.parseBugResponse(response.response);
          bugs.push(...parsed);
          if (parsed.length > 0) {
            this.reportProgress(`Found ${parsed.length} bugs`);
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.reportProgress(`Error: ${msg}`);
      }
    }

    // Assign IDs
    return bugs.map((bug, index) => ({
      ...bug,
      id: bug.id || generateBugId(index),
    }));
  }

  /**
   * Build a simpler prompt optimized for local models with smaller context
   */
  private buildLocalPrompt(
    files: { file: string; content: string }[],
    understanding: CodebaseUnderstanding,
    signals: { file: string; line: number; message: string; severity: string }[],
    isQuick: boolean
  ): string {
    const signalText =
      signals.length > 0
        ? `\nStatic analysis found:\n${signals.map((s) => `- ${s.file}:${s.line}: ${s.message}`).join('\n')}`
        : '';

    const codeBlocks = files
      .map((f) => `### ${f.file}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');

    return `You are a bug hunter. Analyze this code for bugs and security issues.

Project type: ${understanding.summary.type}
Language: ${understanding.summary.language}
${signalText}

${codeBlocks}

Find bugs in these categories: injection, auth-bypass, null-reference, logic-error, resource-leak.

Return JSON with this exact format:
{
  "bugs": [
    {
      "title": "brief bug title",
      "description": "what the bug is",
      "file": "filename.ts",
      "line": 42,
      "severity": "high",
      "category": "logic-error",
      "evidence": ["evidence 1"],
      "confidence": { "overall": "high" },
      "codePath": [{"step": 1, "file": "file.ts", "line": 42, "code": "code", "explanation": "why"}]
    }
  ]
}

Only report ${isQuick ? 'critical/high' : 'all'} severity bugs. Return empty bugs array if no issues found.`;
  }

  private parseBugResponse(content: string): Bug[] {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    let data: { bugs?: unknown[] };
    try {
      data = JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }

    if (!data.bugs || !Array.isArray(data.bugs)) {
      return [];
    }

    return data.bugs
      .map((bug: unknown) => {
        const parsed = PartialBugFromLLM.safeParse(bug);
        if (!parsed.success) return null;

        const b = parsed.data;
        const result: Bug = {
          id: '',
          title: b.title,
          description: b.description,
          file: b.file,
          line: b.line,
          kind: 'bug',
          severity: b.severity || 'medium',
          category: b.category || 'logic-error',
          confidence: {
            overall: b.confidence?.overall || 'medium',
            codePathValidity: b.confidence?.codePathValidity || 0.6,
            reachability: b.confidence?.reachability || 0.6,
            intentViolation: false,
            staticToolSignal: false,
            adversarialSurvived: false,
          },
          codePath: (b.codePath || []).map((cp, idx) => ({
            step: cp.step ?? idx + 1,
            file: cp.file ?? '',
            line: cp.line ?? 0,
            code: cp.code,
            explanation: cp.explanation,
          })),
          evidence: b.evidence || [],
          createdAt: new Date().toISOString(),
          status: 'open',
        };
        if (b.endLine !== undefined) result.endLine = b.endLine;
        if (b.suggestedFix) result.suggestedFix = b.suggestedFix;
        return result;
      })
      .filter((b): b is Bug => b !== null);
  }

  async adversarialValidate(
    bug: Bug,
    _context: AnalysisContext
  ): Promise<AdversarialResult> {
    const client = this.getClient();

    const prompt = `You are a skeptical code reviewer. Challenge this bug report:

BUG:
- Title: ${bug.title}
- Description: ${bug.description}
- File: ${bug.file}:${bug.line}
- Severity: ${bug.severity}
- Category: ${bug.category}

Is this a REAL bug or a FALSE POSITIVE?

Return JSON: { "survived": true/false, "counterArguments": ["arg1", "arg2"] }`;

    try {
      const response = await client.generate({
        model: this.model,
        prompt,
        format: 'json',
        options: { temperature: 0.3 },
      });

      if (response.response) {
        const jsonMatch = response.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[0]);
            const parsed = AdversarialResultSchema.safeParse(data);
            if (parsed.success) {
              return parsed.data;
            }
          } catch {
            // JSON parse failed
          }
        }
      }
    } catch {
      // Fall through to default
    }

    return {
      survived: true,
      counterArguments: [],
    };
  }

  async generateUnderstanding(
    files: string[],
    existingDocsSummary?: string
  ): Promise<CodebaseUnderstanding> {
    const client = this.getClient();

    // Simplified prompt for local models
    const fileList = files.slice(0, 50).join('\n');
    const prompt = `Analyze this codebase structure:

Files:
${fileList}

${existingDocsSummary ? `Documentation: ${existingDocsSummary.slice(0, 1000)}` : ''}

Return JSON:
{
  "summary": {
    "type": "web-app/api/library/cli",
    "description": "brief description",
    "language": "typescript/javascript/etc",
    "framework": "react/express/etc"
  },
  "features": [],
  "contracts": [],
  "dependencies": {}
}`;

    const response = await client.generate({
      model: this.model,
      prompt,
      format: 'json',
      options: { temperature: 0.2 },
    });

    if (!response.response) {
      throw new Error('No response from Ollama');
    }

    const jsonMatch = response.response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse understanding response');
    }

    let data: unknown;
    try {
      data = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse understanding response');
    }

    const parsed = PartialUnderstandingFromLLM.safeParse(data);
    if (!parsed.success) {
      throw new Error('Invalid understanding format');
    }

    const u = parsed.data;
    return {
      version: '1',
      generatedAt: new Date().toISOString(),
      summary: {
        type: u.summary?.type || 'unknown',
        description: u.summary?.description || '',
        language: u.summary?.language || 'unknown',
        framework: u.summary?.framework,
      },
      features: u.features || [],
      contracts: u.contracts || [],
      dependencies: u.dependencies || {},
      structure: {
        totalFiles: files.length,
        totalLines: 0,
        packages: [],
      },
    };
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    const client = this.getClient();
    const models = await client.list();
    return models.models.map((m) => m.name);
  }

  /**
   * Pull a model if not available
   */
  async pullModel(model: string): Promise<void> {
    const client = this.getClient();
    this.reportProgress(`Pulling model ${model}...`);
    await client.pull({ model });
    this.reportProgress(`Model ${model} ready`);
  }
}
