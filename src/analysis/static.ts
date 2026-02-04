import { execa } from 'execa';
import { existsSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { WhiteroseConfig, StaticAnalysisResult } from '../types.js';

export async function runStaticAnalysis(
  cwd: string,
  files: string[],
  config?: WhiteroseConfig
): Promise<StaticAnalysisResult[]> {
  const results: StaticAnalysisResult[] = [];

  // Default to running both if config is not provided
  const shouldRunTypescript = config?.staticAnalysis?.typescript ?? true;
  const shouldRunEslint = config?.staticAnalysis?.eslint ?? true;

  // Run TypeScript compiler
  if (shouldRunTypescript) {
    const tscResults = await runTypeScript(cwd);
    results.push(...tscResults);
  }

  // Run ESLint
  if (shouldRunEslint) {
    const eslintResults = await runEslint(cwd, files);
    results.push(...eslintResults);
  }

  return results;
}

async function runTypeScript(cwd: string): Promise<StaticAnalysisResult[]> {
  const results: StaticAnalysisResult[] = [];

  // Check if tsconfig exists
  const tsconfigPath = join(cwd, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    return results;
  }

  try {
    // Run tsc --noEmit and capture diagnostics
    await execa('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
      cwd,
      timeout: 60000,
    });
  } catch (error: any) {
    // Parse TypeScript errors from stdout
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
    const lines = output.split('\n');

    for (const line of lines) {
      // Format: path/to/file.ts(line,col): error TS1234: message
      const match = line.match(/^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/);
      if (match) {
        const filePath = normalizeFilePath(match[1], cwd);
        results.push({
          tool: 'typescript',
          file: filePath,
          line: parseInt(match[2], 10),
          message: match[6],
          severity: match[4] === 'error' ? 'error' : 'warning',
          code: `TS${match[5]}`,
        });
      }
    }
  }

  return results;
}

async function runEslint(cwd: string, files: string[]): Promise<StaticAnalysisResult[]> {
  const results: StaticAnalysisResult[] = [];

  // Check if eslint config exists
  const hasEslint =
    existsSync(join(cwd, '.eslintrc')) ||
    existsSync(join(cwd, '.eslintrc.js')) ||
    existsSync(join(cwd, '.eslintrc.json')) ||
    existsSync(join(cwd, '.eslintrc.yml')) ||
    existsSync(join(cwd, 'eslint.config.js')) ||
    existsSync(join(cwd, 'eslint.config.mjs'));

  if (!hasEslint) {
    return results;
  }

  if (files.length === 0) {
    return results;
  }

  try {
    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      // Run eslint with JSON output
      const { stdout } = await execa(
        'npx',
        ['eslint', '--format', 'json', '--no-error-on-unmatched-pattern', ...batch],
        {
          cwd,
          timeout: 60000,
          reject: false,
        }
      );

      // ESLint may output warnings before JSON - try to extract JSON array
      let eslintResults: any[] = [];
      try {
        // First try direct parse
        eslintResults = JSON.parse(stdout || '[]');
      } catch {
        // Try to find JSON array in output (skip any prefix warnings)
        const jsonMatch = (stdout || '').match(/\[\s*\{[\s\S]*\}\s*\]|\[\s*\]/);
        if (jsonMatch) {
          try {
            eslintResults = JSON.parse(jsonMatch[0]);
          } catch {
            // Give up on this batch - continue with the next
            continue;
          }
        }
      }

      for (const fileResult of eslintResults) {
        const filePath = normalizeFilePath(fileResult.filePath, cwd);
        for (const message of fileResult.messages || []) {
          results.push({
            tool: 'eslint',
            file: filePath,
            line: message.line || 0,
            message: message.message,
            severity: message.severity === 2 ? 'error' : 'warning',
            code: message.ruleId,
          });
        }
      }
    }
  } catch {
    // ESLint execution failed, skip
  }

  return results;
}

function normalizeFilePath(filePath: string, cwd: string): string {
  if (!filePath) return filePath;
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}
