/**
 * Code Smells Analyzer
 *
 * Detects patterns that indicate poor code quality and are PROBABLE CAUSES for future bugs.
 * These are NOT bugs themselves, but maintainability issues that increase bug risk.
 *
 * Categories based on Martin Fowler's Refactoring catalog + TypeScript-specific patterns:
 *
 * 1. BLOATERS - Code that grows too large
 *    - Long Method, Large Class, Long Parameter List, Data Clumps
 *
 * 2. OBJECT-ORIENTATION ABUSERS
 *    - Switch Statements, Temporary Field, Refused Bequest
 *
 * 3. CHANGE PREVENTERS - Make changes ripple through codebase
 *    - Divergent Change, Shotgun Surgery, Parallel Inheritance
 *
 * 4. DISPENSABLES - Unnecessary elements
 *    - Dead Code, Duplicate Code, Speculative Generality, Comments as Deodorant
 *
 * 5. COUPLERS - Excessive interdependence
 *    - Feature Envy, Message Chains, Middle Man
 *
 * 6. TYPESCRIPT-SPECIFIC
 *    - Excessive 'any', 'as' assertions, Missing error handling
 *
 * 7. MAGIC VALUES
 *    - Hardcoded constants, Magic numbers/strings
 *
 * Sources:
 * - https://refactoring.guru/refactoring/smells
 * - https://ducin.dev/typescript-anti-patterns
 * - https://www.mdpi.com/2078-2489/9/11/273
 */

import { readFileSync } from 'fs';
import { relative } from 'path';
import fg from 'fast-glob';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface CodeSmell {
  type: SmellCategory;
  name: string;
  title: string;
  description: string;
  file: string;
  line: number;
  evidence: string[];
  impact: 'high' | 'medium' | 'low';
  refactoring: string; // Suggested fix
}

type SmellCategory =
  | 'bloater'
  | 'oo-abuser'
  | 'change-preventer'
  | 'dispensable'
  | 'coupler'
  | 'typescript-smell'
  | 'magic-value';

// ─────────────────────────────────────────────────────────────
// Detection Functions
// ─────────────────────────────────────────────────────────────

function detectBloaters(file: string, content: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const lines = content.split('\n');

  // Long Method (> 50 lines)
  const funcRegex =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/;

  let funcStart: { name: string; line: number } | null = null;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(funcRegex);

    if (match && braceCount === 0) {
      funcStart = { name: match[1] || match[2], line: i };
      braceCount = 0;
    }

    if (funcStart) {
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;

      if (braceCount === 0 && i > funcStart.line) {
        const funcLength = i - funcStart.line;
        if (funcLength > 50) {
          smells.push({
            type: 'bloater',
            name: 'long-method',
            title: `Long Method: ${funcStart.name} (${funcLength} lines)`,
            description: `Function "${funcStart.name}" is ${funcLength} lines long. Long methods are harder to understand, test, and maintain.`,
            file,
            line: funcStart.line + 1,
            evidence: [
              `Function length: ${funcLength} lines`,
              'Threshold: 50 lines',
              'Consider extracting smaller functions',
            ],
            impact: funcLength > 100 ? 'high' : 'medium',
            refactoring: 'Extract Method - Break into smaller, focused functions',
          });
        }
        funcStart = null;
      }
    }
  }

  // Long Parameter List (> 4 params)
  const paramListRegex = /function\s+\w+\s*\(([^)]+)\)|=>\s*\(([^)]+)\)/g;
  let paramMatch;
  while ((paramMatch = paramListRegex.exec(content)) !== null) {
    const params = (paramMatch[1] || paramMatch[2] || '').split(',').filter((p) => p.trim());
    if (params.length > 4) {
      const lineNum = content.slice(0, paramMatch.index).split('\n').length;
      smells.push({
        type: 'bloater',
        name: 'long-parameter-list',
        title: `Long Parameter List: ${params.length} parameters`,
        description: `Function has ${params.length} parameters. Long parameter lists make functions harder to call correctly and understand.`,
        file,
        line: lineNum,
        evidence: [`Parameters: ${params.length}`, 'Threshold: 4', `Params: ${params.slice(0, 5).join(', ')}...`],
        impact: 'medium',
        refactoring: 'Introduce Parameter Object - Group related parameters into an object/interface',
      });
    }
  }

  return smells;
}

function detectMagicValues(file: string, content: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments, imports, exports, type definitions, test files
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('import') ||
      trimmed.startsWith('export') ||
      trimmed.startsWith('type') ||
      trimmed.startsWith('interface') ||
      file.includes('.test.') ||
      file.includes('.spec.')
    ) {
      continue;
    }

    // Magic numbers - only flag significant numbers used in comparisons/conditions
    // Skip: array access, common values, timeouts, port numbers, etc.
    const magicNumMatch = line.match(/(?:===?|!==?|>=?|<=?|<|>)\s*(\d{3,})/);
    if (magicNumMatch) {
      const num = magicNumMatch[1];
      // Skip common thresholds
      if (!['100', '1000', '10000', '60000', '120000', '300000'].includes(num)) {
        smells.push({
          type: 'magic-value',
          name: 'magic-number',
          title: `Magic Number in comparison: ${num}`,
          description: `Hardcoded number "${num}" in comparison makes code harder to understand. What does ${num} represent?`,
          file,
          line: i + 1,
          evidence: [`Value: ${num}`, `Context: ${trimmed.slice(0, 60)}`],
          impact: 'low',
          refactoring: 'Replace Magic Number with Named Constant (e.g., MAX_FILE_SIZE, TIMEOUT_MS)',
        });
      }
    }
  }

  return smells;
}

function detectTypeScriptSmells(file: string, content: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      continue;
    }

    // Excessive 'any' usage
    if (line.includes(': any') || line.includes('<any>') || line.includes('as any')) {
      smells.push({
        type: 'typescript-smell',
        name: 'any-type',
        title: `Use of 'any' type`,
        description: `The 'any' type disables TypeScript's type checking. This loses the benefits of static typing and can hide bugs.`,
        file,
        line: i + 1,
        evidence: [`Pattern: ${trimmed.slice(0, 60)}`, "Consider: specific type, 'unknown', or generic"],
        impact: 'medium',
        refactoring: "Replace 'any' with a specific type, 'unknown', or generic type parameter",
      });
    }

    // Unsafe 'as' assertions (except for common safe patterns)
    if (
      line.includes(' as ') &&
      !line.includes(' as const') &&
      !line.includes(' as string') &&
      !line.includes(' as number')
    ) {
      const asMatch = line.match(/as\s+(\w+)/);
      if (asMatch && !['const', 'string', 'number', 'boolean'].includes(asMatch[1])) {
        smells.push({
          type: 'typescript-smell',
          name: 'unsafe-assertion',
          title: `Unsafe type assertion: as ${asMatch[1]}`,
          description: `Type assertion 'as ${asMatch[1]}' bypasses type checking. If the data doesn't match, errors occur at runtime, not compile time.`,
          file,
          line: i + 1,
          evidence: [`Assertion: as ${asMatch[1]}`, 'Risk: Runtime type mismatch'],
          impact: 'medium',
          refactoring: 'Use type guards, Zod validation, or unknown type with narrowing',
        });
      }
    }

    // Non-null assertion (!)
    if (line.match(/\w+!\./)) {
      smells.push({
        type: 'typescript-smell',
        name: 'non-null-assertion',
        title: `Non-null assertion (!.)`,
        description: `Non-null assertion tells TypeScript to ignore possible null/undefined. This can cause runtime errors if the value is actually nullish.`,
        file,
        line: i + 1,
        evidence: [`Pattern: ${trimmed.slice(0, 60)}`, 'Risk: NullPointerException at runtime'],
        impact: 'medium',
        refactoring: 'Use optional chaining (?.) or add explicit null check',
      });
    }
  }

  return smells;
}

function detectDispensables(file: string, content: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // TODO/FIXME comments (technical debt markers)
    if (trimmed.includes('TODO') || trimmed.includes('FIXME') || trimmed.includes('HACK')) {
      const marker = trimmed.includes('TODO') ? 'TODO' : trimmed.includes('FIXME') ? 'FIXME' : 'HACK';
      smells.push({
        type: 'dispensable',
        name: 'todo-comment',
        title: `${marker} comment`,
        description: `${marker} comments indicate unfinished work or known issues. They tend to accumulate and become stale.`,
        file,
        line: i + 1,
        evidence: [`Comment: ${trimmed.slice(0, 60)}`],
        impact: 'low',
        refactoring: 'Complete the TODO, create an issue, or remove if obsolete',
      });
    }

    // Commented-out code (not regular comments)
    if (
      trimmed.startsWith('//') &&
      (trimmed.includes('const ') ||
        trimmed.includes('let ') ||
        trimmed.includes('function') ||
        trimmed.includes('return ') ||
        trimmed.includes('if ('))
    ) {
      smells.push({
        type: 'dispensable',
        name: 'commented-code',
        title: `Commented-out code`,
        description: `Commented-out code clutters the codebase and becomes confusing over time. Use version control to preserve old code instead.`,
        file,
        line: i + 1,
        evidence: [`Code: ${trimmed.slice(0, 60)}`],
        impact: 'low',
        refactoring: 'Delete commented code (git preserves history)',
      });
    }

    // console.log in production code (except in CLI files)
    if (trimmed.startsWith('console.log') && !file.includes('/cli/') && !file.includes('.test.')) {
      smells.push({
        type: 'dispensable',
        name: 'debug-statement',
        title: `Debug statement: console.log`,
        description: `console.log statements in production code may leak sensitive information and clutter logs.`,
        file,
        line: i + 1,
        evidence: [`Statement: ${trimmed.slice(0, 60)}`],
        impact: 'low',
        refactoring: 'Remove or replace with proper logging framework',
      });
    }
  }

  return smells;
}

function detectCouplers(file: string, content: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Message Chains (a.b.c.d.e - more than 3 levels)
    const chainMatch = line.match(/(\w+(?:\.\w+){3,})/);
    if (chainMatch && !line.includes('import') && !chainMatch[1].includes('console')) {
      const chain = chainMatch[1];
      const levels = chain.split('.').length;
      smells.push({
        type: 'coupler',
        name: 'message-chain',
        title: `Message Chain: ${levels} levels deep`,
        description: `Long chain of method calls "${chain}" creates tight coupling and makes the code fragile to changes in intermediate objects.`,
        file,
        line: i + 1,
        evidence: [`Chain: ${chain}`, `Depth: ${levels} levels`, 'Law of Demeter violation'],
        impact: 'medium',
        refactoring: 'Hide Delegate - Create wrapper methods to reduce chain length',
      });
    }
  }

  return smells;
}

// ─────────────────────────────────────────────────────────────
// Main Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Run code smells analysis and return findings
 */
export async function analyzeSmells(cwd: string): Promise<CodeSmell[]> {
  const smells: CodeSmell[] = [];

  // Find source files
  const sourceFiles = await fg(['**/*.ts', '**/*.tsx'], {
    cwd,
    ignore: ['node_modules/**', 'dist/**', '**/*.d.ts'],
    absolute: true,
  });

  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf-8');
    const relPath = relative(cwd, file);

    smells.push(
      ...detectBloaters(relPath, content),
      ...detectMagicValues(relPath, content),
      ...detectTypeScriptSmells(relPath, content),
      ...detectDispensables(relPath, content),
      ...detectCouplers(relPath, content)
    );
  }

  // Sort by impact
  const impactOrder = { high: 0, medium: 1, low: 2 };
  smells.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);

  return smells;
}

/**
 * Get summary of code smells for reporting
 */
export async function getSmellsSummary(cwd: string): Promise<string> {
  const smells = await analyzeSmells(cwd);

  const lines: string[] = ['# Code Smells Report\n'];
  lines.push(
    '> These are NOT bugs, but patterns that increase the likelihood of future bugs.\n'
  );
  lines.push(`Total smells: ${smells.length}\n`);

  // Group by category
  const byCategory = new Map<SmellCategory, CodeSmell[]>();
  for (const smell of smells) {
    if (!byCategory.has(smell.type)) byCategory.set(smell.type, []);
    byCategory.get(smell.type)!.push(smell);
  }

  const categoryNames: Record<SmellCategory, string> = {
    bloater: 'Bloaters (Code that grows too large)',
    'oo-abuser': 'OO Abusers (Improper OOP usage)',
    'change-preventer': 'Change Preventers (Ripple effects)',
    dispensable: 'Dispensables (Unnecessary code)',
    coupler: 'Couplers (Tight coupling)',
    'typescript-smell': 'TypeScript Anti-patterns',
    'magic-value': 'Magic Values (Hardcoded constants)',
  };

  for (const [category, categorySmells] of byCategory) {
    lines.push(`## ${categoryNames[category]} (${categorySmells.length})\n`);

    // Group by impact
    const byImpact = { high: [] as CodeSmell[], medium: [] as CodeSmell[], low: [] as CodeSmell[] };
    for (const s of categorySmells) {
      byImpact[s.impact].push(s);
    }

    for (const impact of ['high', 'medium', 'low'] as const) {
      if (byImpact[impact].length > 0) {
        lines.push(`### ${impact.toUpperCase()} Impact\n`);
        for (const s of byImpact[impact].slice(0, 10)) {
          lines.push(`- **${s.title}** - ${s.file}:${s.line}`);
          lines.push(`  - ${s.refactoring}`);
        }
        if (byImpact[impact].length > 10) {
          lines.push(`  - ... and ${byImpact[impact].length - 10} more`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

export type { CodeSmell, SmellCategory };
