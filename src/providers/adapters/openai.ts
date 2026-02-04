/**
 * OpenAI Provider (GPT-4o, Codex models)
 *
 * Uses the official OpenAI SDK for API-based analysis.
 * Supports GPT-4o, GPT-4o-mini, and Codex models.
 *
 * Configuration:
 * - OPENAI_API_KEY environment variable required
 * - Model can be configured in whiterose config
 *
 * @see https://platform.openai.com/docs/guides/code-generation
 */

import OpenAI from 'openai';
import { readFileSync } from 'fs';
import {
  LLMProvider,
  ProviderType,
  AnalysisContext,
  Bug,
  AdversarialResult,
  CodebaseUnderstanding,
  AnalyzeOptions,
  StaticAnalysisResult,
} from '../../types.js';
import { generateBugId } from '../../core/utils.js';
import {
  PartialBugFromLLM,
  PartialUnderstandingFromLLM,
  AdversarialResultSchema,
} from '../../core/validation.js';
import {
  BUG_CATEGORIES_PROMPT,
  SEVERITY_DEFINITIONS_PROMPT,
} from '../prompts/constants.js';

// Default models for different tasks
const MODELS = {
  analysis: 'gpt-4o', // Best for code analysis
  quick: 'gpt-4o-mini', // Faster for quick scans
  understanding: 'gpt-4o', // For codebase understanding
};

type ProgressCallback = (message: string) => void;

export class OpenAIProvider implements LLMProvider {
  name: ProviderType = 'codex'; // Using 'codex' as the provider type
  private client: OpenAI | null = null;
  private progressCallback?: ProgressCallback;
  private model: string = MODELS.analysis;

  constructor(model?: string) {
    if (model) {
      this.model = model;
    }
  }

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OpenAI API key not found. Set OPENAI_API_KEY environment variable.'
        );
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async detect(): Promise<boolean> {
    return !!process.env.OPENAI_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    if (!process.env.OPENAI_API_KEY) {
      return false;
    }

    try {
      // Quick API check
      const client = this.getClient();
      await client.models.list();
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
    const model = isQuick ? MODELS.quick : this.model;

    this.reportProgress(`Analyzing ${files.length} files with ${model}...`);

    // Process files in batches to avoid token limits
    const batchSize = isQuick ? 5 : 3;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      this.reportProgress(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)}...`
      );

      // Read file contents
      const fileContents = batch.map((file) => {
        try {
          const content = readFileSync(file, 'utf-8');
          return { file, content: content.slice(0, 10000) }; // Limit size
        } catch {
          return { file, content: '// Could not read file' };
        }
      });

      // Get static analysis signals for these files
      const signals = staticAnalysisResults.filter((s) =>
        batch.some((f) => f.endsWith(s.file) || s.file.endsWith(f))
      );

      // Build prompt
      const prompt = this.buildAnalysisPrompt(
        fileContents,
        understanding,
        signals,
        isQuick
      );

      try {
        const response = await client.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: `You are an expert security auditor and bug hunter. Analyze code for bugs, security vulnerabilities, and logic errors. Return findings as JSON.

${BUG_CATEGORIES_PROMPT}

${SEVERITY_DEFINITIONS_PROMPT}`,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2, // Low temperature for consistent analysis
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const parsed = this.parseBugResponse(content);
          bugs.push(...parsed);
          this.reportProgress(`Found ${parsed.length} bugs in batch`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.reportProgress(`Error analyzing batch: ${msg}`);
      }
    }

    // Assign IDs
    return bugs.map((bug, index) => ({
      ...bug,
      id: bug.id || generateBugId(index),
    }));
  }

  private buildAnalysisPrompt(
    files: { file: string; content: string }[],
    understanding: CodebaseUnderstanding,
    signals: StaticAnalysisResult[],
    isQuick: boolean
  ): string {
    const signalText =
      signals.length > 0
        ? `\n## STATIC ANALYSIS FINDINGS:\n${signals.map((s) => `- ${s.file}:${s.line} [${s.tool}]: ${s.message}`).join('\n')}\n`
        : '';

    const codeBlocks = files
      .map((f) => `### ${f.file}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');

    return `## PROJECT CONTEXT
Type: ${understanding.summary.type}
Language: ${understanding.summary.language}
Description: ${understanding.summary.description}
${signalText}
## CODE TO ANALYZE
${codeBlocks}

## INSTRUCTIONS
Find bugs in these categories: injection, auth-bypass, null-reference, logic-error, resource-leak, async-issue, boundary-error.

${isQuick ? 'Focus on HIGH and CRITICAL severity bugs only.' : 'Report ALL bugs found.'}

Return JSON in this exact format:
{
  "bugs": [
    {
      "title": "Brief descriptive title",
      "description": "Detailed explanation of the bug",
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "critical|high|medium|low",
      "category": "bug-category",
      "evidence": ["Evidence 1", "Evidence 2"],
      "confidence": {
        "overall": "high|medium|low",
        "codePathValidity": 0.8,
        "reachability": 0.8
      },
      "codePath": [
        {"step": 1, "file": "file.ts", "line": 10, "code": "code here", "explanation": "step explanation"}
      ],
      "suggestedFix": "Optional fix suggestion"
    }
  ]
}

Return empty bugs array if no issues found.`;
  }

  private parseBugResponse(content: string): Bug[] {
    let data: { bugs?: unknown[] };
    try {
      data = JSON.parse(content);
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
            codePathValidity: b.confidence?.codePathValidity || 0.7,
            reachability: b.confidence?.reachability || 0.7,
            intentViolation: b.confidence?.intentViolation || false,
            staticToolSignal: b.confidence?.staticToolSignal || false,
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

BUG REPORT:
- Title: ${bug.title}
- Description: ${bug.description}
- File: ${bug.file}:${bug.line}
- Severity: ${bug.severity}
- Category: ${bug.category}
- Evidence: ${bug.evidence.join(', ')}

Determine if this is a REAL bug or a FALSE POSITIVE.

Return JSON:
{
  "survived": true/false,
  "counterArguments": ["argument 1", "argument 2"]
}

Set "survived" to true if the bug is real, false if it's likely a false positive.`;

    try {
      const response = await client.chat.completions.create({
        model: MODELS.analysis,
        messages: [
          {
            role: 'system',
            content:
              'You are a skeptical code reviewer. Challenge the validity of reported bugs.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        try {
          const data = JSON.parse(content);
          const parsed = AdversarialResultSchema.safeParse(data);
          if (parsed.success) {
            return parsed.data;
          }
        } catch {
          // JSON parse failed
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

    const fileList = files.slice(0, 100).join('\n');

    const prompt = `Analyze this codebase structure and generate a comprehensive understanding.

FILES:
${fileList}

${existingDocsSummary ? `EXISTING DOCUMENTATION:\n${existingDocsSummary.slice(0, 2000)}` : ''}

Return JSON in this exact format:
{
  "summary": {
    "type": "web-app|api|library|cli|mobile-app|other",
    "description": "Brief description of what this project does",
    "language": "typescript|javascript|python|etc",
    "framework": "react|express|next|etc (optional)"
  },
  "features": [
    {
      "name": "Feature name",
      "description": "What it does",
      "priority": "critical|high|medium|low",
      "constraints": ["constraint 1"],
      "relatedFiles": ["file1.ts"]
    }
  ],
  "contracts": [
    {
      "name": "Contract name",
      "description": "What it guarantees",
      "type": "invariant|precondition|postcondition|data-flow",
      "enforcementLevel": "critical|important|nice-to-have"
    }
  ],
  "dependencies": {
    "package-name": "version"
  },
  "structure": {
    "totalLines": 0,
    "packages": ["src", "tests"]
  }
}`;

    const response = await client.chat.completions.create({
      model: MODELS.understanding,
      messages: [
        {
          role: 'system',
          content:
            'You are a software architect analyzing a codebase. Generate a comprehensive understanding of the project.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
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
}
