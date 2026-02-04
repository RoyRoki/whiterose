/**
 * Cross-File Analyzer
 *
 * Detects bugs that span multiple files/commands:
 * - Incomplete features (scan writes to A,B,C but clear only clears A)
 * - State mismatches (command X expects state that command Y doesn't set)
 * - Orphaned operations (writes without corresponding cleanup)
 *
 * This catches bugs that single-file analysis misses.
 */

import { readFileSync } from 'fs';
import { relative, basename } from 'path';
import fg from 'fast-glob';
import { Bug } from '../types.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface FileEffect {
  file: string;           // Source file
  type: 'read' | 'write' | 'delete';
  target: string;         // What it reads/writes (file path pattern or description)
  line: number;
  code: string;
  functionName?: string;
}

interface CommandInfo {
  name: string;           // Command name (e.g., 'scan', 'clear', 'fix')
  file: string;           // Source file
  reads: FileEffect[];    // What state/files it reads
  writes: FileEffect[];   // What state/files it writes
  deletes: FileEffect[];  // What state/files it deletes
}

interface CrossFileBug {
  type: 'incomplete-feature' | 'state-mismatch' | 'orphaned-write' | 'missing-cleanup';
  title: string;
  description: string;
  involvedFiles: string[];
  evidence: string[];
  severity: 'high' | 'medium' | 'low';
}

// ─────────────────────────────────────────────────────────────
// Effect Extraction
// ─────────────────────────────────────────────────────────────

/**
 * Extract file effects (reads/writes/deletes) from source code
 */
function extractFileEffects(filePath: string, content: string): FileEffect[] {
  const effects: FileEffect[] = [];
  const lines = content.split('\n');

  // Patterns that indicate file operations
  const patterns = [
    // Write patterns
    { regex: /writeFileSync\s*\(\s*([^,]+)/, type: 'write' as const },
    { regex: /writeFile\s*\(\s*([^,]+)/, type: 'write' as const },
    { regex: /fs\.writeFileSync\s*\(\s*([^,]+)/, type: 'write' as const },
    { regex: /fs\.writeFile\s*\(\s*([^,]+)/, type: 'write' as const },
    { regex: /\.write\s*\(\s*([^,]+)/, type: 'write' as const },
    { regex: /saveCache\s*\(/, type: 'write' as const },
    { regex: /saveBugStatus\s*\(/, type: 'write' as const },
    { regex: /saveAccumulatedBugs\s*\(/, type: 'write' as const },

    // Read patterns
    { regex: /readFileSync\s*\(\s*([^,]+)/, type: 'read' as const },
    { regex: /readFile\s*\(\s*([^,]+)/, type: 'read' as const },
    { regex: /fs\.readFileSync\s*\(\s*([^,]+)/, type: 'read' as const },
    { regex: /loadCache\s*\(/, type: 'read' as const },
    { regex: /loadBugStatus\s*\(/, type: 'read' as const },
    { regex: /loadAccumulatedBugs\s*\(/, type: 'read' as const },
    { regex: /loadBugsFromSarif\s*\(/, type: 'read' as const },

    // Delete patterns
    { regex: /rmSync\s*\(\s*([^,]+)/, type: 'delete' as const },
    { regex: /unlinkSync\s*\(\s*([^,]+)/, type: 'delete' as const },
    { regex: /rm\s*\(\s*([^,]+)/, type: 'delete' as const },
    { regex: /clearAccumulatedBugs\s*\(/, type: 'delete' as const },
    { regex: /clearCache\s*\(/, type: 'delete' as const },
    { regex: /removeBugFromAccumulated\s*\(/, type: 'delete' as const },
  ];

  // Track current function for context
  let currentFunction = '';
  const functionRegex = /(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip commented lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Track function context
    const funcMatch = line.match(functionRegex);
    if (funcMatch) {
      currentFunction = funcMatch[1] || funcMatch[2] || funcMatch[3] || '';
    }

    // Check for file operations
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        // Try to extract the target path/description
        let target = match[1] || 'unknown';

        // Clean up the target - extract meaningful parts
        target = target.trim().replace(/['"`,]/g, '');

        // Look for path patterns in the line
        const pathPatterns = [
          /accumulated-bugs\.json/,
          /bug-status\.json/,
          /analysis-cache\.json/,
          /file-hashes\.json/,
          /\.sarif/,
          /\.whiterose/,
          /whiterose-output/,
          /reports/,
          /cache/,
        ];

        for (const pp of pathPatterns) {
          if (line.match(pp)) {
            target = line.match(pp)?.[0] || target;
            break;
          }
        }

        effects.push({
          file: filePath,
          type: pattern.type,
          target,
          line: lineNum,
          code: line.trim(),
          functionName: currentFunction,
        });
      }
    }
  }

  return effects;
}

/**
 * Identify CLI commands from the codebase
 */
async function findCommands(cwd: string): Promise<CommandInfo[]> {
  const commands: CommandInfo[] = [];

  // Find command files
  const commandFiles = await fg(['**/cli/commands/*.ts', '**/commands/*.ts'], {
    cwd,
    ignore: ['node_modules/**', 'dist/**'],
    absolute: true,
  });

  for (const file of commandFiles) {
    const content = readFileSync(file, 'utf-8');
    const effects = extractFileEffects(file, content);

    // Extract command name from filename or export
    const name = basename(file, '.ts');

    commands.push({
      name,
      file,
      reads: effects.filter(e => e.type === 'read'),
      writes: effects.filter(e => e.type === 'write'),
      deletes: effects.filter(e => e.type === 'delete'),
    });
  }

  return commands;
}

// ─────────────────────────────────────────────────────────────
// Cross-File Bug Detection
// ─────────────────────────────────────────────────────────────

/**
 * Find incomplete features where writes don't have corresponding cleanup
 */
function findIncompleteFeatures(commands: CommandInfo[]): CrossFileBug[] {
  const bugs: CrossFileBug[] = [];

  // Find "clear" or "reset" commands
  const clearCommands = commands.filter(c =>
    c.name.includes('clear') || c.name.includes('reset') || c.name.includes('clean')
  );

  // Find "write" commands (scan, init, etc.)
  const writeCommands = commands.filter(c => c.writes.length > 0);

  // For each clear command, check if it clears everything that write commands create
  for (const clearCmd of clearCommands) {
    const clearedTargets = new Set([
      ...clearCmd.deletes.map(d => normalizeTarget(d.target)),
    ]);

    for (const writeCmd of writeCommands) {
      if (writeCmd.name === clearCmd.name) continue; // Skip self

      for (const write of writeCmd.writes) {
        const normalizedTarget = normalizeTarget(write.target);

        // Check if this write target is cleared
        const isCleared = [...clearedTargets].some(cleared =>
          targetsMatch(cleared, normalizedTarget)
        );

        if (!isCleared && isSignificantTarget(normalizedTarget)) {
          bugs.push({
            type: 'incomplete-feature',
            title: `${clearCmd.name} doesn't clear ${normalizedTarget} written by ${writeCmd.name}`,
            description: `The '${clearCmd.name}' command deletes some state but not '${normalizedTarget}' which is written by '${writeCmd.name}'. This can cause stale data to persist after clearing.`,
            involvedFiles: [clearCmd.file, writeCmd.file],
            evidence: [
              `${writeCmd.name} writes to ${normalizedTarget} at ${relative(process.cwd(), writeCmd.file)}:${write.line}`,
              `${clearCmd.name} doesn't delete ${normalizedTarget}`,
              `Code: ${write.code}`,
            ],
            severity: 'high',
          });
        }
      }
    }
  }

  return bugs;
}

/**
 * Find state mismatches where a command reads state that might not exist
 */
function findStateMismatches(commands: CommandInfo[]): CrossFileBug[] {
  const bugs: CrossFileBug[] = [];

  // Build a map of what creates each piece of state
  const stateCreators = new Map<string, CommandInfo[]>();

  for (const cmd of commands) {
    for (const write of cmd.writes) {
      const target = normalizeTarget(write.target);
      if (!stateCreators.has(target)) {
        stateCreators.set(target, []);
      }
      stateCreators.get(target)!.push(cmd);
    }
  }

  // Check if commands read state that might not be created
  for (const cmd of commands) {
    for (const read of cmd.reads) {
      const target = normalizeTarget(read.target);
      const creators = stateCreators.get(target) || [];

      // If nothing creates this state, it's a potential issue
      // (unless it's optional state with fallback)
      if (creators.length === 0 && isSignificantTarget(target) && !hasFallback(read.code)) {
        bugs.push({
          type: 'state-mismatch',
          title: `${cmd.name} reads ${target} but nothing creates it`,
          description: `The '${cmd.name}' command reads '${target}' but no other command appears to create this state. This could cause errors if the state doesn't exist.`,
          involvedFiles: [cmd.file],
          evidence: [
            `${cmd.name} reads ${target} at ${relative(process.cwd(), cmd.file)}:${read.line}`,
            `No command found that creates ${target}`,
            `Code: ${read.code}`,
          ],
          severity: 'medium',
        });
      }
    }
  }

  return bugs;
}

/**
 * Find fallback chains - where command A falls back to B if C is empty
 * This can cause bugs like: clear C, but A still shows data from B
 */
function findFallbackChainBugs(commands: CommandInfo[]): CrossFileBug[] {
  const bugs: CrossFileBug[] = [];

  // Look for commands that read multiple sources (fallback pattern)
  for (const cmd of commands) {
    const readTargets = cmd.reads.map(r => normalizeTarget(r.target));
    const uniqueTargets = [...new Set(readTargets)];

    if (uniqueTargets.length > 1) {
      // This command has multiple read sources - potential fallback
      // Check if clear commands clear ALL of them

      const clearCommands = commands.filter(c =>
        c.name.includes('clear') || c.name.includes('reset')
      );

      for (const clearCmd of clearCommands) {
        const clearedTargets = clearCmd.deletes.map(d => normalizeTarget(d.target));

        const unclearedTargets = uniqueTargets.filter(target =>
          !clearedTargets.some(cleared => targetsMatch(cleared, target)) &&
          isSignificantTarget(target)
        );

        if (unclearedTargets.length > 0 && clearedTargets.length > 0) {
          // Clear clears some but not all read sources
          bugs.push({
            type: 'incomplete-feature',
            title: `${cmd.name} has fallback sources not cleared by ${clearCmd.name}`,
            description: `The '${cmd.name}' command reads from multiple sources (${uniqueTargets.join(', ')}), but '${clearCmd.name}' only clears some of them. After clearing, '${cmd.name}' may still show data from fallback sources: ${unclearedTargets.join(', ')}.`,
            involvedFiles: [cmd.file, clearCmd.file],
            evidence: [
              `${cmd.name} reads from: ${uniqueTargets.join(', ')}`,
              `${clearCmd.name} clears: ${clearedTargets.join(', ')}`,
              `Not cleared: ${unclearedTargets.join(', ')}`,
            ],
            severity: 'high',
          });
        }
      }
    }
  }

  return bugs;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function normalizeTarget(target: string): string {
  // Normalize path targets for comparison
  return target
    .replace(/['"]/g, '')
    .replace(/\$\{[^}]+\}/g, '*')  // Replace template vars with wildcard
    .replace(/\+/g, '')
    .trim()
    .toLowerCase();
}

function targetsMatch(a: string, b: string): boolean {
  // Check if two targets refer to the same thing
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Check for common patterns
  const patterns = [
    ['accumulated-bugs', 'accumulated'],
    ['sarif', 'reports'],
    ['bug-status', 'status'],
    ['analysis-cache', 'cache'],
  ];

  for (const [p1, p2] of patterns) {
    if ((a.includes(p1) && b.includes(p2)) || (a.includes(p2) && b.includes(p1))) {
      return true;
    }
  }

  return false;
}

function isSignificantTarget(target: string): boolean {
  // Filter out generic/uninteresting targets (variable names, params)
  const dominated = ['unknown', 'path', 'file', 'dir', 'content', 'filepath', 'safepath'];
  if (dominated.some(d => target === d)) return false;

  // Filter out external files (not created by our commands)
  const external = ['gitignore', 'package.json', 'tsconfig', 'node_modules'];
  if (external.some(e => target.includes(e))) return false;

  // Filter out user-provided paths (options.*, args, etc.)
  if (target.includes('options.') || target.includes('args')) return false;

  // Filter out config files that shouldn't be cleared (they're core config, not bug data)
  const coreConfig = ['config.yml', 'intent.md', 'understanding.yml', 'whiterosepath'];
  if (coreConfig.some(c => target.includes(c))) return false;

  // Filter out variable names that refer to output dir contents (these ARE cleared)
  // Note: sarifpath is NOT excluded because fix reads from reports/*.sarif which is different
  const outputVars = ['mdpath', 'jsonpath'];
  if (outputVars.some(v => target === v)) return false;

  // Filter out hash files (created by scanner internals, not commands)
  if (target.includes('hashes')) return false;

  // Only interested in bug-data state that should be cleared together
  const bugDataState = [
    'accumulated-bugs', 'bug-status', 'analysis-cache',
    'sarif', 'reports', 'whiterose-output',
  ];
  return bugDataState.some(i => target.includes(i));
}

function hasFallback(code: string): boolean {
  // Check if the code has a fallback (try/catch, || default, etc.)
  return code.includes('catch') || code.includes('||') || code.includes('??');
}

// ─────────────────────────────────────────────────────────────
// Main Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Run cross-file analysis and return bugs
 */
export async function analyzeCrossFile(cwd: string): Promise<Bug[]> {
  const commands = await findCommands(cwd);

  if (commands.length === 0) {
    return [];
  }

  const crossFileBugs: CrossFileBug[] = [
    ...findIncompleteFeatures(commands),
    ...findStateMismatches(commands),
    ...findFallbackChainBugs(commands),
  ];

  // Convert to Bug format
  return crossFileBugs.map((cfb, index) => ({
    id: `CROSS-${String(index + 1).padStart(3, '0')}`,
    title: cfb.title,
    description: cfb.description,
    file: cfb.involvedFiles[0],
    line: 1,
    severity: cfb.severity as Bug['severity'],
    category: 'logic-error' as Bug['category'],
    confidence: {
      overall: 'high' as const,
      codePathValidity: 0.9,
      reachability: 0.9,
      intentViolation: true,
      staticToolSignal: false,
      adversarialSurvived: false,
    },
    codePath: cfb.involvedFiles.map((f, i) => ({
      step: i + 1,
      file: f,
      line: 1,
      code: '',
      explanation: i === 0 ? 'Primary file' : 'Related file',
    })),
    evidence: cfb.evidence,
    createdAt: new Date().toISOString(),
    status: 'open' as const,
  }));
}

/**
 * Get summary of command effects for debugging
 */
export async function getCommandEffectsSummary(cwd: string): Promise<string> {
  const commands = await findCommands(cwd);

  const lines: string[] = ['# Command Effects Summary\n'];

  for (const cmd of commands) {
    lines.push(`## ${cmd.name}`);
    lines.push(`File: ${relative(cwd, cmd.file)}\n`);

    if (cmd.reads.length > 0) {
      lines.push('**Reads:**');
      for (const r of cmd.reads) {
        lines.push(`- ${r.target} (line ${r.line})`);
      }
      lines.push('');
    }

    if (cmd.writes.length > 0) {
      lines.push('**Writes:**');
      for (const w of cmd.writes) {
        lines.push(`- ${w.target} (line ${w.line})`);
      }
      lines.push('');
    }

    if (cmd.deletes.length > 0) {
      lines.push('**Deletes:**');
      for (const d of cmd.deletes) {
        lines.push(`- ${d.target} (line ${d.line})`);
      }
      lines.push('');
    }

    lines.push('---\n');
  }

  return lines.join('\n');
}
