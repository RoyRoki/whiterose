import * as p from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Bug, ScanResult } from '../../types.js';
import { loadConfig } from '../../core/config.js';
import { startFixTUI } from '../../tui/index.js';
import { applyFix } from '../../core/fixer.js';

interface FixOptions {
  dryRun: boolean;
  branch?: string;
}

export async function fixCommand(bugId: string | undefined, options: FixOptions): Promise<void> {
  const cwd = process.cwd();
  const whiterosePath = join(cwd, '.whiterose');

  // Check if initialized
  if (!existsSync(whiterosePath)) {
    p.log.error('whiterose is not initialized in this directory.');
    p.log.info('Run "whiterose init" first.');
    process.exit(1);
  }

  // Load config
  const config = await loadConfig(cwd);

  // Find latest scan result
  const reportsDir = join(whiterosePath, 'reports');
  if (!existsSync(reportsDir)) {
    p.log.error('No scan results found. Run "whiterose scan" first.');
    process.exit(1);
  }

  // Get latest SARIF file
  const reports = readdirSync(reportsDir)
    .filter((f) => f.endsWith('.sarif'))
    .sort()
    .reverse();

  if (reports.length === 0) {
    p.log.error('No scan results found. Run "whiterose scan" first.');
    process.exit(1);
  }

  const latestReport = join(reportsDir, reports[0]);
  const sarif = JSON.parse(readFileSync(latestReport, 'utf-8'));

  // Convert SARIF back to bugs
  const bugs: Bug[] = sarif.runs?.[0]?.results?.map((r: any, i: number) => {
    // Try to extract full bug info from SARIF properties if available
    const props = r.properties || {};

    return {
      id: r.ruleId || `WR-${String(i + 1).padStart(3, '0')}`,
      title: r.message?.text || 'Unknown bug',
      description: r.message?.markdown || r.message?.text || '',
      file: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || 'unknown',
      line: r.locations?.[0]?.physicalLocation?.region?.startLine || 0,
      endLine: r.locations?.[0]?.physicalLocation?.region?.endLine,
      severity: mapSarifLevel(r.level),
      category: props.category || 'logic-error',
      confidence: {
        overall: props.confidence || 'medium',
        codePathValidity: props.codePathValidity || 0.8,
        reachability: props.reachability || 0.8,
        intentViolation: props.intentViolation || false,
        staticToolSignal: props.staticToolSignal || false,
        adversarialSurvived: props.adversarialSurvived || false,
      },
      codePath: r.codeFlows?.[0]?.threadFlows?.[0]?.locations?.map((loc: any, idx: number) => ({
        step: idx + 1,
        file: loc.location?.physicalLocation?.artifactLocation?.uri || '',
        line: loc.location?.physicalLocation?.region?.startLine || 0,
        code: '',
        explanation: loc.message?.text || '',
      })) || [],
      evidence: props.evidence || [],
      suggestedFix: props.suggestedFix,
      createdAt: new Date().toISOString(),
    };
  }) || [];

  if (bugs.length === 0) {
    p.log.success('No bugs to fix!');
    process.exit(0);
  }

  // If specific bug ID provided, fix just that bug
  if (bugId) {
    const bug = bugs.find((b) => b.id === bugId || b.id.toLowerCase() === bugId.toLowerCase());
    if (!bug) {
      p.log.error(`Bug ${bugId} not found.`);
      p.log.info('Available bugs: ' + bugs.map((b) => b.id).join(', '));
      process.exit(1);
    }

    p.intro(chalk.red('whiterose') + chalk.dim(' - fixing bug'));

    // Show bug details
    console.log();
    console.log(chalk.bold(`  ${bug.id}: ${bug.title}`));
    console.log(`  ${chalk.dim('File:')} ${bug.file}:${bug.line}`);
    console.log(`  ${chalk.dim('Severity:')} ${bug.severity}`);
    console.log();
    console.log(`  ${bug.description}`);
    console.log();

    if (bug.suggestedFix) {
      console.log(chalk.dim('  Suggested fix:'));
      console.log(`  ${chalk.green(bug.suggestedFix)}`);
      console.log();
    }

    // Confirm fix
    if (!options.dryRun) {
      const confirm = await p.confirm({
        message: 'Apply this fix?',
        initialValue: true,
      });

      if (p.isCancel(confirm) || !confirm) {
        p.cancel('Fix cancelled.');
        process.exit(0);
      }
    }

    // Apply fix
    const spinner = p.spinner();
    spinner.start(options.dryRun ? 'Generating fix preview...' : 'Applying fix...');

    try {
      const result = await applyFix(bug, config, options);

      if (result.success) {
        spinner.stop(options.dryRun ? 'Fix preview generated' : 'Fix applied');

        if (result.diff) {
          console.log();
          console.log(chalk.dim('  Changes:'));
          for (const line of result.diff.split('\n')) {
            if (line.startsWith('+')) {
              console.log(chalk.green(`  ${line}`));
            } else if (line.startsWith('-')) {
              console.log(chalk.red(`  ${line}`));
            } else {
              console.log(chalk.dim(`  ${line}`));
            }
          }
          console.log();
        }

        if (result.branchName) {
          p.log.info(`Changes committed to branch: ${result.branchName}`);
        }

        p.outro(chalk.green('Fix complete!'));
      } else {
        spinner.stop('Fix failed');
        p.log.error(result.error || 'Unknown error');
        process.exit(1);
      }
    } catch (error: any) {
      spinner.stop('Fix failed');
      p.log.error(error.message);
      process.exit(1);
    }

    return;
  }

  // Launch interactive TUI
  try {
    await startFixTUI(bugs, config, options);
  } catch (error: any) {
    // If Ink fails (e.g., not a TTY), fall back to simple mode
    if (error.message?.includes('stdin') || error.message?.includes('TTY')) {
      p.log.warn('Interactive mode not available. Use "whiterose fix <bug-id>" to fix specific bugs.');
      p.log.info('Available bugs:');
      for (const bug of bugs) {
        const severityColor = bug.severity === 'critical' ? 'red' : bug.severity === 'high' ? 'yellow' : 'blue';
        console.log(`  ${chalk[severityColor]('●')} ${bug.id}: ${bug.title}`);
      }
    } else {
      throw error;
    }
  }
}

function mapSarifLevel(level: string): 'critical' | 'high' | 'medium' | 'low' {
  switch (level) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'note':
      return 'low';
    default:
      return 'medium';
  }
}
