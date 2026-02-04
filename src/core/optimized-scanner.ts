/**
 * Optimized Scanner
 *
 * Implements tiered scanning with AST-based analysis:
 * - Instant: <5 seconds, changed functions only
 * - Standard: 2-4 minutes, changed + impacted files
 * - Deep: Full codebase analysis
 *
 * Key optimizations:
 * 1. AST-based function extraction (not whole files)
 * 2. Dependency graph for impact analysis
 * 3. Function-level caching
 * 4. Smart context building for LLM
 */

import { execa } from 'execa';
import { existsSync } from 'fs';
import { join, relative, resolve, isAbsolute } from 'path';
import fg from 'fast-glob';
import {
  analyzeFile,
  findChangedUnits,
  buildOptimizedContext,
  formatContextForPrompt,
  parseGitDiffLines,
  CodeUnit,
  FileAnalysis,
  OptimizedContext,
} from './ast-analysis.js';
import {
  loadCache,
  getCachedResult,
  setCachedResult,
  expandCachedBugs,
  type CacheFile,
} from './analysis-cache.js';
import { getDependentFiles } from './dependencies.js';
import { Bug, CodebaseUnderstanding, StaticAnalysisResult } from '../types.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ScanTier = 'instant' | 'standard' | 'deep';

export interface ScanConfig {
  tier: ScanTier;
  maxTokensPerFile: number;
  useCache: boolean;
  includeImpactedFiles: boolean;
  parallelFiles: number;
}

export interface ScanTarget {
  filePath: string;
  changedLines: number[];
  isImpacted: boolean; // true if file is impacted by changes but not directly changed
}

export interface OptimizedScanResult {
  targets: ScanTarget[];
  contexts: Map<string, OptimizedContext>;
  cacheStats: {
    hits: number;
    misses: number;
  };
  estimatedTime: string;
}

// ─────────────────────────────────────────────────────────────
// Default Configurations
// ─────────────────────────────────────────────────────────────

export const TIER_CONFIGS: Record<ScanTier, ScanConfig> = {
  instant: {
    tier: 'instant',
    maxTokensPerFile: 4000, // Smaller context for speed
    useCache: true,
    includeImpactedFiles: false, // Only changed files
    parallelFiles: 10, // High parallelism
  },
  standard: {
    tier: 'standard',
    maxTokensPerFile: 8000,
    useCache: true,
    includeImpactedFiles: true, // Include impacted files
    parallelFiles: 5,
  },
  deep: {
    tier: 'deep',
    maxTokensPerFile: 16000, // Full context
    useCache: false, // Always fresh analysis
    includeImpactedFiles: true,
    parallelFiles: 3, // Lower parallelism for thoroughness
  },
};

// ─────────────────────────────────────────────────────────────
// Main Scanner Functions
// ─────────────────────────────────────────────────────────────

/**
 * Get changed files and lines from git
 */
export async function getGitChanges(cwd: string, base?: string): Promise<Map<string, number[]>> {
  try {
    // Default to comparing against HEAD for unstaged changes, or against base branch
    const diffCommand = base
      ? ['diff', '--unified=0', base, 'HEAD']
      : ['diff', '--unified=0', 'HEAD'];

    const { stdout } = await execa('git', diffCommand, { cwd });

    if (!stdout.trim()) {
      // No changes against HEAD, check for staged changes
      const { stdout: stagedDiff } = await execa('git', ['diff', '--unified=0', '--staged'], { cwd });
      if (stagedDiff.trim()) {
        return parseGitDiffLines(stagedDiff);
      }
      return new Map();
    }

    return parseGitDiffLines(stdout);
  } catch {
    return new Map();
  }
}

/**
 * Prepare scan targets based on tier configuration
 */
export async function prepareScanTargets(
  cwd: string,
  tier: ScanTier,
  specificFiles?: string[]
): Promise<ScanTarget[]> {
  const config = TIER_CONFIGS[tier];
  const targets: ScanTarget[] = [];

  if (specificFiles && specificFiles.length > 0) {
    // Use specific files provided
    for (const file of specificFiles) {
      targets.push({
        filePath: file,
        changedLines: [], // Analyze entire file
        isImpacted: false,
      });
    }
    return targets;
  }

  if (tier === 'deep') {
    // Deep scan: all files
    const allFiles = await fg(['**/*.{ts,tsx,js,jsx}'], {
      cwd,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', '**/*.test.*', '**/*.spec.*'],
      absolute: true,
    });

    for (const file of allFiles) {
      targets.push({
        filePath: file,
        changedLines: [], // Analyze entire file
        isImpacted: false,
      });
    }
    return targets;
  }

  // Get git changes
  const changedFiles = await getGitChanges(cwd);

  if (changedFiles.size === 0) {
    return [];
  }

  // Add changed files
  for (const [file, lines] of changedFiles) {
    const absolutePath = join(cwd, file);
    if (existsSync(absolutePath) && (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx'))) {
      targets.push({
        filePath: absolutePath,
        changedLines: lines,
        isImpacted: false,
      });
    }
  }

  // For standard tier, add impacted files
  if (config.includeImpactedFiles && targets.length > 0) {
    const changedPaths = targets.map((t) => t.filePath);
    const impactedFiles = await getDependentFiles(changedPaths, cwd);

    for (const file of impactedFiles) {
      if (!targets.some((t) => t.filePath === file)) {
        targets.push({
          filePath: file,
          changedLines: [], // Analyze functions that depend on changes
          isImpacted: true,
        });
      }
    }
  }

  return targets;
}

/**
 * Build optimized context for a single file
 */
export function buildFileContext(
  target: ScanTarget,
  config: ScanConfig
): { analysis: FileAnalysis; context: OptimizedContext } | null {
  const analysis = analyzeFile(target.filePath);
  if (!analysis) return null;

  // Find which units to analyze
  let unitsToAnalyze: CodeUnit[];

  if (target.changedLines.length > 0) {
    // Only analyze changed functions
    unitsToAnalyze = findChangedUnits(analysis, target.changedLines);
  } else if (target.isImpacted) {
    // For impacted files, analyze exported functions (API surface)
    unitsToAnalyze = analysis.units.filter((u) => u.exported);
  } else {
    // Analyze all functions
    unitsToAnalyze = analysis.units;
  }

  if (unitsToAnalyze.length === 0) {
    return null;
  }

  // Build optimized context
  const context = buildOptimizedContext(unitsToAnalyze, analysis, config.maxTokensPerFile);

  return { analysis, context };
}

/**
 * Check cache for existing results
 */
export function checkCache(
  cache: CacheFile,
  units: CodeUnit[],
  filePath: string
): { cachedBugs: Bug[]; uncachedUnits: CodeUnit[] } {
  const cachedBugs: Bug[] = [];
  const uncachedUnits: CodeUnit[] = [];

  for (const unit of units) {
    const cacheKey = getUnitCacheKey(unit);
    const cached = getCachedResult(cache, cacheKey);
    if (cached) {
      // Expand cached bugs
      const bugs = expandCachedBugs(cached, filePath, `CACHED-${unit.name}`);
      cachedBugs.push(...bugs);
    } else {
      uncachedUnits.push(unit);
    }
  }

  return { cachedBugs, uncachedUnits };
}

/**
 * Format context for LLM prompt - optimized version
 */
export function formatOptimizedPromptContext(
  target: ScanTarget,
  context: OptimizedContext,
  _understanding: CodebaseUnderstanding,
  staticResults: StaticAnalysisResult[]
): string {
  const sections: string[] = [];
  const normalizedStaticResults = staticResults.map((r) => ({
    ...r,
    file: normalizeFilePath(r.file),
  }));

  // File header
  const relativePath = relative(process.cwd(), target.filePath);
  sections.push(`# FILE: ${relativePath}`);
  sections.push(`# LINES CHANGED: ${target.changedLines.length > 0 ? target.changedLines.join(', ') : 'Full file'}`);
  sections.push(`# ESTIMATED TOKENS: ${context.estimatedTokens}`);
  sections.push('');

  // Static analysis findings for this file
  const fileStaticResults = normalizedStaticResults.filter((r) => r.file === target.filePath);
  if (fileStaticResults.length > 0) {
    sections.push('# STATIC ANALYSIS FINDINGS:');
    for (const result of fileStaticResults) {
      sections.push(`# - Line ${result.line} [${result.tool}]: ${result.message}`);
    }
    sections.push('');
  }

  // Format the optimized context
  sections.push(formatContextForPrompt(context));

  return sections.join('\n');
}

function normalizeFilePath(filePath: string): string {
  if (!filePath) return filePath;
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

/**
 * Prepare the full scan - returns all contexts ready for analysis
 */
export async function prepareOptimizedScan(
  cwd: string,
  tier: ScanTier,
  _understanding: CodebaseUnderstanding,
  _staticResults: StaticAnalysisResult[],
  specificFiles?: string[]
): Promise<OptimizedScanResult> {
  const config = TIER_CONFIGS[tier];
  const targets = await prepareScanTargets(cwd, tier, specificFiles);

  const contexts = new Map<string, OptimizedContext>();
  let cacheHits = 0;
  let cacheMisses = 0;

  // Load cache if enabled
  const cache = config.useCache ? loadCache(cwd) : null;

  for (const target of targets) {
    const result = buildFileContext(target, config);
    if (result) {
      contexts.set(target.filePath, result.context);

      // Check cache
      if (cache) {
        const { cachedBugs: _cachedBugs, uncachedUnits } = checkCache(
          cache,
          result.context.changedUnits,
          target.filePath
        );
        cacheHits += result.context.changedUnits.length - uncachedUnits.length;
        cacheMisses += uncachedUnits.length;
      } else {
        cacheMisses += result.context.changedUnits.length;
      }
    }
  }

  // Estimate time based on tier and targets
  const estimatedTime = estimateScanTime(tier, targets.length, contexts.size);

  return {
    targets: targets.filter((t) => contexts.has(t.filePath)),
    contexts,
    cacheStats: { hits: cacheHits, misses: cacheMisses },
    estimatedTime,
  };
}

/**
 * Estimate scan time based on tier and number of targets
 */
function estimateScanTime(tier: ScanTier, _targetCount: number, contextCount: number): string {
  // Rough estimates based on typical LLM response times
  const baseTimePerContext: Record<ScanTier, number> = {
    instant: 2, // 2 seconds per context
    standard: 5, // 5 seconds per context
    deep: 15, // 15 seconds per context
  };

  const parallelism = TIER_CONFIGS[tier].parallelFiles;
  const totalSeconds = Math.ceil((contextCount * baseTimePerContext[tier]) / parallelism);

  if (totalSeconds < 60) {
    return `~${totalSeconds} seconds`;
  } else if (totalSeconds < 3600) {
    return `~${Math.ceil(totalSeconds / 60)} minutes`;
  } else {
    return `~${(totalSeconds / 3600).toFixed(1)} hours`;
  }
}

/**
 * Store analysis results in cache
 */
export function cacheResults(
  cache: CacheFile,
  filePath: string,
  units: CodeUnit[],
  bugs: Bug[]
): void {
  // Group bugs by unit (based on line overlap)
  for (const unit of units) {
    const unitBugs = bugs.filter(
      (bug) => bug.line >= unit.startLine && bug.line <= unit.endLine
    );

    setCachedResult(cache, getUnitCacheKey(unit), filePath, unit.name, unit.type, unitBugs);
  }
}

function getUnitCacheKey(unit: CodeUnit): string {
  return unit.contextHash || unit.hash;
}

/**
 * Get summary of scan preparation
 */
export function getScanSummary(result: OptimizedScanResult, tier: ScanTier): string {
  const lines: string[] = [];

  lines.push(`Scan Tier: ${tier.toUpperCase()}`);
  lines.push(`Files to analyze: ${result.targets.length}`);
  lines.push(`  - Changed: ${result.targets.filter((t) => !t.isImpacted).length}`);
  lines.push(`  - Impacted: ${result.targets.filter((t) => t.isImpacted).length}`);
  lines.push(`Functions to analyze: ${Array.from(result.contexts.values()).reduce((sum, ctx) => sum + ctx.changedUnits.length, 0)}`);

  if (result.cacheStats.hits > 0) {
    lines.push(`Cache: ${result.cacheStats.hits} hits, ${result.cacheStats.misses} misses`);
  }

  lines.push(`Estimated time: ${result.estimatedTime}`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Export for use in scanner
// ─────────────────────────────────────────────────────────────

export {
  analyzeFile,
  findChangedUnits,
  buildOptimizedContext,
  formatContextForPrompt,
} from './ast-analysis.js';
export type {
  CodeUnit,
  FileAnalysis,
  OptimizedContext,
} from './ast-analysis.js';
