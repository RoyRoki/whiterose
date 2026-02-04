/**
 * Contract Analyzer
 *
 * Detects bugs related to:
 * - Missing error recovery (write without rollback on failure)
 * - Missing validation (parse without verify)
 * - Missing post-conditions (fix without verify it works)
 * - Transaction atomicity violations (multi-step operations that can fail partially)
 *
 * This extends the cross-file analyzer to catch behavioral bugs.
 */

import { readFileSync } from 'fs';
import { relative } from 'path';
import fg from 'fast-glob';
import { Bug } from '../types.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ContractViolation {
  type:
    | 'missing-rollback'
    | 'missing-verification'
    | 'weak-validation'
    | 'partial-failure'
    | 'unhandled-error';
  title: string;
  description: string;
  file: string;
  line: number;
  evidence: string[];
  severity: 'high' | 'medium' | 'low';
}

interface CodeBlock {
  file: string;
  functionName: string;
  startLine: number;
  endLine: number;
  content: string;
}

// ─────────────────────────────────────────────────────────────
// Pattern Detection
// ─────────────────────────────────────────────────────────────

/**
 * Detect write operations without corresponding rollback in catch blocks
 */
function detectMissingRollback(block: CodeBlock): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const lines = block.content.split('\n');

  // Find writeFileSync calls
  const writeOps: { line: number; target: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/writeFileSync\s*\(\s*([^,]+)/);
    if (match) {
      writeOps.push({ line: block.startLine + i, target: match[1].trim() });
    }
  }

  if (writeOps.length === 0) return violations;

  // Check if there's error handling with rollback
  const hasRollbackPattern =
    block.content.includes('catch') &&
    (block.content.includes('restore') ||
      block.content.includes('rollback') ||
      block.content.includes('writeFileSync') && block.content.includes('originalContent'));

  // Check if there are operations after write that can fail
  for (const writeOp of writeOps) {
    const afterWrite = lines.slice(writeOp.line - block.startLine + 1).join('\n');

    // Operations that can fail after write
    const canFailAfter =
      afterWrite.includes('await ') ||
      afterWrite.includes('execa') ||
      afterWrite.includes('commitFix') ||
      afterWrite.includes('throw');

    if (canFailAfter && !hasRollbackPattern) {
      violations.push({
        type: 'missing-rollback',
        title: `No rollback if operation fails after writing to ${writeOp.target}`,
        description: `File is written at line ${writeOp.line}, but subsequent operations can fail without restoring the original content. If those operations fail, the file is left in a partially modified state.`,
        file: block.file,
        line: writeOp.line,
        evidence: [
          `Write operation: writeFileSync(${writeOp.target}, ...)`,
          'Operations after write can fail (async calls, commits, etc.)',
          'No rollback/restore pattern detected in catch block',
        ],
        severity: 'high',
      });
    }
  }

  return violations;
}

/**
 * Detect operations that should verify their result but don't
 */
function detectMissingVerification(block: CodeBlock): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const lines = block.content.split('\n');

  // Pattern: write a "fix" without verifying it works
  const hasFixWrite =
    block.content.includes('fixedContent') ||
    (block.content.includes('fix') && block.content.includes('writeFileSync'));

  const hasVerification =
    block.content.includes('compile') ||
    block.content.includes('typecheck') ||
    block.content.includes('verify') ||
    block.content.includes('tsc ') ||
    block.content.includes('eslint');

  // Check for functions that apply fixes
  const isFixFunction =
    block.functionName.toLowerCase().includes('fix') ||
    block.functionName.toLowerCase().includes('apply');

  if (hasFixWrite && !hasVerification && isFixFunction) {
    // Find the write line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('writeFileSync')) {
        violations.push({
          type: 'missing-verification',
          title: `Fix written without verification in ${block.functionName}`,
          description: `The function writes a "fix" to a file but doesn't verify that the fix actually works (e.g., code still compiles, passes tests, or bug is actually fixed).`,
          file: block.file,
          line: block.startLine + i,
          evidence: [
            `Function: ${block.functionName}`,
            'Writes content to file',
            'No compilation/validation check after write',
            'Applied fix may introduce new errors',
          ],
          severity: 'high',
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * Detect weak validation patterns
 */
function detectWeakValidation(block: CodeBlock): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const lines = block.content.split('\n');
  const reportedLines = new Set<number>(); // One violation per line max

  // Check if this is in a parse/validate function
  if (
    !block.functionName.toLowerCase().includes('parse') &&
    !block.functionName.toLowerCase().includes('validate') &&
    !block.functionName.toLowerCase().includes('extract')
  ) {
    return violations;
  }

  // Pattern: Parsing something and accepting it with minimal checks
  for (let i = 0; i < lines.length; i++) {
    if (reportedLines.has(i)) continue;

    const line = lines[i];

    // Check for weak validation patterns
    const weakPatterns = [
      { regex: /matchCount\s*>=?\s*\d/, issue: 'Accepts content if only a few lines match' },
      { regex: /\.length\s*>\s*\w+\.length\s*\*\s*0\.\d/, issue: 'Accepts content based only on length ratio' },
    ];

    const issues: string[] = [];
    for (const pattern of weakPatterns) {
      if (line.match(pattern.regex)) {
        issues.push(pattern.issue);
      }
    }

    if (issues.length > 0) {
      reportedLines.add(i);
      violations.push({
        type: 'weak-validation',
        title: `Weak validation in ${block.functionName}`,
        description: `The validation logic may accept invalid input: ${issues.join('; ')}. This could allow malformed or incorrect data to pass through.`,
        file: block.file,
        line: block.startLine + i,
        evidence: [
          `Function: ${block.functionName}`,
          `Pattern: ${line.trim()}`,
          `Issues: ${issues.join(', ')}`,
        ],
        severity: 'medium',
      });
    }
  }

  return violations;
}

/**
 * Detect loops that break on error without reporting skipped items
 */
function detectPartialFailure(block: CodeBlock): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const lines = block.content.split('\n');

  // Pattern: for loop with break on error
  let inForLoop = false;
  let forLoopStart = 0;
  let forLoopItem = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect for loop start
    const forMatch = line.match(/for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of/);
    if (forMatch) {
      inForLoop = true;
      forLoopStart = i;
      forLoopItem = forMatch[1];
    }

    // Check for break pattern inside loop
    if (inForLoop && line.includes('break')) {
      // Check if it's breaking on failure without reporting
      const hasFailureCheck =
        lines.slice(Math.max(0, i - 3), i + 1).join('\n').includes('!result.success') ||
        lines.slice(Math.max(0, i - 3), i + 1).join('\n').includes('error') ||
        lines.slice(Math.max(0, i - 3), i + 1).join('\n').includes('failed');

      const hasSkippedReport =
        block.content.includes('skipped') ||
        block.content.includes('remaining') ||
        block.content.includes('not attempted');

      if (hasFailureCheck && !hasSkippedReport) {
        violations.push({
          type: 'partial-failure',
          title: `Loop breaks on error without reporting skipped items in ${block.functionName}`,
          description: `The loop iterates over "${forLoopItem}" but breaks on first failure without indicating which items were not processed. Users won't know what was skipped.`,
          file: block.file,
          line: block.startLine + i,
          evidence: [
            `Function: ${block.functionName}`,
            `Loop variable: ${forLoopItem}`,
            'Breaks on failure condition',
            'No reporting of skipped/remaining items',
          ],
          severity: 'medium',
        });
      }
    }

    // Detect loop end (simple heuristic)
    if (inForLoop && line.trim() === '}' && i > forLoopStart + 2) {
      inForLoop = false;
    }
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────
// Code Block Extraction
// ─────────────────────────────────────────────────────────────

function extractFunctions(filePath: string, content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');

  // Simple function detection (async function, function, arrow function)
  const funcRegex =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/;

  let currentFunc: { name: string; start: number; braceCount: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip commented lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Check for function start
    if (!currentFunc) {
      const match = line.match(funcRegex);
      if (match) {
        const funcName = match[1] || match[2];
        currentFunc = { name: funcName, start: i, braceCount: 0 };
      }
    }

    // Track braces to find function end
    if (currentFunc) {
      currentFunc.braceCount += (line.match(/{/g) || []).length;
      currentFunc.braceCount -= (line.match(/}/g) || []).length;

      if (currentFunc.braceCount <= 0 && i > currentFunc.start) {
        blocks.push({
          file: filePath,
          functionName: currentFunc.name,
          startLine: currentFunc.start + 1,
          endLine: i + 1,
          content: lines.slice(currentFunc.start, i + 1).join('\n'),
        });
        currentFunc = null;
      }
    }
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────
// Main Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Run contract analysis and return bugs
 */
export async function analyzeContracts(cwd: string): Promise<Bug[]> {
  const violations: ContractViolation[] = [];

  // Find source files
  const sourceFiles = await fg(['**/*.ts', '**/*.tsx'], {
    cwd,
    ignore: ['node_modules/**', 'dist/**', '**/*.test.ts', '**/*.spec.ts'],
    absolute: true,
  });

  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf-8');
    const blocks = extractFunctions(file, content);

    for (const block of blocks) {
      violations.push(
        ...detectMissingRollback(block),
        ...detectMissingVerification(block),
        ...detectWeakValidation(block),
        ...detectPartialFailure(block)
      );
    }
  }

  // Convert to Bug format
  return violations.map((v, index) => ({
    id: `CONTRACT-${String(index + 1).padStart(3, '0')}`,
    title: v.title,
    description: v.description,
    file: relative(cwd, v.file),
    line: v.line,
    severity: v.severity as Bug['severity'],
    category: 'logic-error' as Bug['category'],
    confidence: {
      overall: 'medium' as const,
      codePathValidity: 0.8,
      reachability: 0.8,
      intentViolation: true,
      staticToolSignal: false,
      adversarialSurvived: false,
    },
    codePath: [
      {
        step: 1,
        file: relative(cwd, v.file),
        line: v.line,
        code: '',
        explanation: v.type,
      },
    ],
    evidence: v.evidence,
    createdAt: new Date().toISOString(),
    status: 'open' as const,
  }));
}

/**
 * Get summary of contract violations for debugging
 */
export async function getContractSummary(cwd: string): Promise<string> {
  const bugs = await analyzeContracts(cwd);

  const lines: string[] = ['# Contract Analysis Summary\n'];
  lines.push(`Total violations: ${bugs.length}\n`);

  const byType = new Map<string, Bug[]>();
  for (const bug of bugs) {
    const type = bug.codePath[0]?.explanation || 'unknown';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(bug);
  }

  for (const [type, typeBugs] of byType) {
    lines.push(`## ${type} (${typeBugs.length})`);
    for (const bug of typeBugs) {
      lines.push(`- ${bug.file}:${bug.line} - ${bug.title}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
