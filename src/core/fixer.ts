import { execa } from 'execa';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, basename, resolve, relative, isAbsolute } from 'path';
import { Bug, WhiteroseConfig } from '../types.js';
import { createFixBranch, commitFix } from './git.js';

/**
 * Validates that a file path is within the project directory.
 * Prevents path traversal attacks from malicious bug.file values.
 */
function isPathWithinProject(filePath: string, projectDir: string): boolean {
  const resolvedPath = resolve(projectDir, filePath);
  const relativePath = relative(projectDir, resolvedPath);

  // Path is outside if it starts with '..' or is an absolute path
  return !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

/**
 * Sanitizes and validates a file path for safe operations.
 * Returns the resolved absolute path if valid, throws if invalid.
 */
function validateFilePath(filePath: string, projectDir: string): string {
  // Resolve to absolute path
  const resolvedPath = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath);

  // Check for path traversal
  if (!isPathWithinProject(resolvedPath, projectDir)) {
    throw new Error(`Security: Refusing to access file outside project directory: ${filePath}`);
  }

  // Check for suspicious patterns
  if (filePath.includes('\0') || filePath.includes('..')) {
    throw new Error(`Security: Invalid file path contains suspicious characters: ${filePath}`);
  }

  return resolvedPath;
}

interface FixOptions {
  dryRun: boolean;
  branch?: string;
}

interface FixResult {
  success: boolean;
  diff?: string;
  error?: string;
  branchName?: string;
}

export async function applyFix(
  bug: Bug,
  config: WhiteroseConfig,
  options: FixOptions
): Promise<FixResult> {
  const { dryRun, branch } = options;
  const projectDir = process.cwd();

  // SECURITY: Validate file path to prevent path traversal
  let safePath: string;
  try {
    safePath = validateFilePath(bug.file, projectDir);
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }

  // Read the original file
  if (!existsSync(safePath)) {
    return {
      success: false,
      error: `File not found: ${bug.file}`,
    };
  }

  const originalContent = readFileSync(safePath, 'utf-8');
  const lines = originalContent.split('\n');

  // If we have a suggested fix, try to apply it
  let fixedContent: string;
  let diff: string;

  if (bug.suggestedFix) {
    // Try to apply the suggested fix by replacing the relevant lines
    const result = applySimpleFix(lines, bug.line, bug.endLine || bug.line, bug.suggestedFix);
    if (result.success) {
      fixedContent = result.content;
      diff = result.diff;
    } else {
      // Fall back to LLM-based fix
      const llmResult = await generateAndApplyFix(bug, config, originalContent, safePath);
      if (!llmResult.success) {
        return llmResult;
      }
      fixedContent = llmResult.content!;
      diff = llmResult.diff!;
    }
  } else {
    // No suggested fix, use LLM
    const llmResult = await generateAndApplyFix(bug, config, originalContent, safePath);
    if (!llmResult.success) {
      return llmResult;
    }
    fixedContent = llmResult.content!;
    diff = llmResult.diff!;
  }

  // Dry run - just show the diff
  if (dryRun) {
    console.log('\n--- Dry Run: Proposed changes ---');
    console.log(diff);
    console.log('--- End of proposed changes ---\n');
    return {
      success: true,
      diff,
    };
  }

  // Create branch if needed
  let branchName: string | undefined;
  if (branch) {
    branchName = await createFixBranch(branch, bug);
  }

  // Write the fixed content (using validated safe path)
  writeFileSync(safePath, fixedContent, 'utf-8');

  // Commit the change
  if (branchName || !branch) {
    await commitFix(bug);
  }

  return {
    success: true,
    diff,
    branchName,
  };
}

function applySimpleFix(
  lines: string[],
  startLine: number,
  endLine: number,
  fix: string
): { success: boolean; content: string; diff: string } {
  // Simple fix application: replace lines startLine to endLine with the fix
  // This works for simple one-line or few-line fixes

  const lineIndex = startLine - 1; // Convert to 0-indexed
  const endIndex = endLine - 1;

  if (lineIndex < 0 || lineIndex >= lines.length) {
    return { success: false, content: '', diff: '' };
  }

  // Get the indentation of the original line
  const originalLine = lines[lineIndex];
  const indentMatch = originalLine.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';

  // Apply indentation to fix
  const fixLines = fix.split('\n').map((line, i) => {
    if (i === 0 || line.trim() === '') return line;
    return indent + line.trimStart();
  });

  // Build the diff
  const removedLines = lines.slice(lineIndex, endIndex + 1);
  const diff = [
    `--- ${lines[lineIndex]}`,
    ...removedLines.map((l) => `- ${l}`),
    ...fixLines.map((l) => `+ ${l}`),
  ].join('\n');

  // Create the new content
  const newLines = [...lines.slice(0, lineIndex), ...fixLines, ...lines.slice(endIndex + 1)];

  return {
    success: true,
    content: newLines.join('\n'),
    diff,
  };
}

async function generateAndApplyFix(
  bug: Bug,
  _config: WhiteroseConfig,
  originalContent: string,
  safePath?: string
): Promise<{ success: boolean; content?: string; diff?: string; error?: string }> {
  try {
    // Build a prompt for fixing
    const prompt = buildFixPrompt(bug, originalContent);

    // Use validated path for cwd, fallback to process.cwd()
    const workingDir = safePath ? dirname(safePath) : process.cwd();

    // Use the provider to generate a fix
    // We'll use execa directly since we need a specific prompt format
    const { stdout } = await execa(
      'claude',
      ['-p', prompt, '--output-format', 'text'],
      {
        cwd: workingDir,
        timeout: 120000,
        env: { ...process.env, NO_COLOR: '1' },
      }
    );

    // Parse the fixed content from the response
    const fixedContent = parseFixResponse(stdout, originalContent);
    if (!fixedContent) {
      return {
        success: false,
        error: 'Failed to parse fix from LLM response',
      };
    }

    // Generate diff
    const diff = generateDiff(originalContent, fixedContent, bug.file);

    return {
      success: true,
      content: fixedContent,
      diff,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error generating fix',
    };
  }
}

function buildFixPrompt(bug: Bug, originalContent: string): string {
  return `Fix the following bug in the code.

BUG DETAILS:
- Title: ${bug.title}
- Description: ${bug.description}
- File: ${bug.file}
- Line: ${bug.line}${bug.endLine ? `-${bug.endLine}` : ''}
- Category: ${bug.category}
- Severity: ${bug.severity}

EVIDENCE:
${bug.evidence.map((e) => `- ${e}`).join('\n')}

CODE PATH:
${bug.codePath.map((s) => `${s.step}. ${s.file}:${s.line} - ${s.explanation}`).join('\n')}

ORIGINAL FILE CONTENT:
\`\`\`
${originalContent}
\`\`\`

${bug.suggestedFix ? `SUGGESTED FIX APPROACH:\n${bug.suggestedFix}\n\n` : ''}

Please provide the COMPLETE fixed file content. Output ONLY the fixed code, no explanations.
Wrap the code in \`\`\` code blocks.

IMPORTANT:
- Fix ONLY the identified bug
- Do not refactor or change anything else
- Preserve all formatting and style
- Ensure the fix actually addresses the bug`;
}

function parseFixResponse(response: string, originalContent: string): string | null {
  // Try to extract code from markdown code blocks
  const codeBlockMatch = response.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim();
    // Validate it looks like code (has some similar lines)
    const originalLines = originalContent.split('\n').slice(0, 5);
    const extractedLines = extracted.split('\n').slice(0, 5);

    // Check if at least some lines match (accounting for the fix)
    let matchCount = 0;
    for (const origLine of originalLines) {
      if (extractedLines.some((l) => l.trim() === origLine.trim())) {
        matchCount++;
      }
    }

    if (matchCount >= 2 || extracted.length > originalContent.length * 0.5) {
      return extracted;
    }
  }

  // If no code block, check if the entire response looks like code
  if (response.includes('function') || response.includes('const ') || response.includes('import ')) {
    return response.trim();
  }

  return null;
}

function generateDiff(original: string, fixed: string, filename: string): string {
  const origLines = original.split('\n');
  const fixedLines = fixed.split('\n');

  const diff: string[] = [`--- a/${basename(filename)}`, `+++ b/${basename(filename)}`];

  // Simple line-by-line diff
  const maxLen = Math.max(origLines.length, fixedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i];
    const fixedLine = fixedLines[i];

    if (origLine === undefined) {
      diff.push(`+ ${fixedLine}`);
    } else if (fixedLine === undefined) {
      diff.push(`- ${origLine}`);
    } else if (origLine !== fixedLine) {
      diff.push(`- ${origLine}`);
      diff.push(`+ ${fixedLine}`);
    }
  }

  return diff.join('\n');
}

export async function batchFix(
  bugs: Bug[],
  config: WhiteroseConfig,
  options: FixOptions
): Promise<Map<string, FixResult>> {
  const results = new Map<string, FixResult>();

  for (const bug of bugs) {
    const result = await applyFix(bug, config, options);
    results.set(bug.id, result);

    // If any fix fails in non-dry-run mode, stop
    if (!result.success && !options.dryRun) {
      break;
    }
  }

  return results;
}
