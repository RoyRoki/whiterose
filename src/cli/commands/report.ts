import * as p from '@clack/prompts';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { outputMarkdown } from '../../output/markdown.js';
import { ScanResult, Bug } from '../../types.js';

interface ReportOptions {
  output: string;
  format: 'markdown' | 'sarif' | 'json';
}

export async function reportCommand(options: ReportOptions): Promise<void> {
  const cwd = process.cwd();
  const whiterosePath = join(cwd, '.whiterose');

  // Check if initialized
  if (!existsSync(whiterosePath)) {
    p.log.error('whiterose is not initialized in this directory.');
    p.log.info('Run "whiterose init" first.');
    process.exit(1);
  }

  // Find latest scan result
  const reportsDir = join(whiterosePath, 'reports');
  if (!existsSync(reportsDir)) {
    p.log.error('No scan results found. Run "whiterose scan" first.');
    process.exit(1);
  }

  const reports = readdirSync(reportsDir)
    .filter((f) => f.endsWith('.sarif'))
    .sort()
    .reverse();

  if (reports.length === 0) {
    p.log.error('No scan results found. Run "whiterose scan" first.');
    process.exit(1);
  }

  const latestReport = join(reportsDir, reports[0]);
  let sarif: any;
  try {
    sarif = JSON.parse(readFileSync(latestReport, 'utf-8'));
  } catch (error) {
    p.log.error(`Failed to parse SARIF report: ${latestReport}`);
    process.exit(1);
  }

  // Convert SARIF to ScanResult
  const bugs: Bug[] = sarif.runs?.[0]?.results?.map((r: any, i: number) => ({
    id: r.ruleId || `WR-${String(i + 1).padStart(3, '0')}`,
    title: r.message?.text || 'Unknown bug',
    description: r.message?.markdown || r.message?.text || '',
    file: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || 'unknown',
    line: r.locations?.[0]?.physicalLocation?.region?.startLine || 0,
    kind: 'bug',
    severity: r.level === 'error' ? 'high' : r.level === 'warning' ? 'medium' : 'low',
    category: 'logic-error',
    confidence: { overall: 'high', codePathValidity: 0.9, reachability: 0.9, intentViolation: false, staticToolSignal: false, adversarialSurvived: true },
    codePath: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    status: 'open',
  })) || [];

  const result: ScanResult = {
    id: 'report',
    timestamp: new Date().toISOString(),
    scanType: 'full',
    filesScanned: 0,
    duration: 0,
    bugs,
    summary: {
      critical: bugs.filter((b) => b.kind === 'bug' && b.severity === 'critical').length,
      high: bugs.filter((b) => b.kind === 'bug' && b.severity === 'high').length,
      medium: bugs.filter((b) => b.kind === 'bug' && b.severity === 'medium').length,
      low: bugs.filter((b) => b.kind === 'bug' && b.severity === 'low').length,
      total: bugs.length,
      bugs: bugs.filter((b) => b.kind === 'bug').length,
      smells: bugs.filter((b) => b.kind === 'smell').length,
    },
  };

  // Generate output
  let output: string;
  switch (options.format) {
    case 'markdown':
      output = outputMarkdown(result);
      break;
    case 'sarif':
      output = readFileSync(latestReport, 'utf-8');
      break;
    case 'json':
      output = JSON.stringify(result, null, 2);
      break;
    default:
      output = outputMarkdown(result);
  }

  // Write or print
  if (options.output === '-') {
    console.log(output);
  } else {
    writeFileSync(options.output, output);
    p.log.success(`Report written to ${options.output}`);
  }
}
