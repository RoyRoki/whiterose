import * as p from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { clearAccumulatedBugs, getAccumulatedBugsStats } from '../../core/bug-merger.js';

interface ClearOptions {
  force: boolean;
}

export async function clearCommand(options: ClearOptions): Promise<void> {
  const cwd = process.cwd();
  const whiterosePath = join(cwd, '.whiterose');

  // Check if initialized
  if (!existsSync(whiterosePath)) {
    p.log.error('whiterose is not initialized in this directory.');
    p.log.info('Run "whiterose init" first.');
    process.exit(1);
  }

  // Get current stats
  const stats = getAccumulatedBugsStats(cwd);

  if (stats.total === 0) {
    p.log.info('No accumulated bugs to clear.');
    process.exit(0);
  }

  p.intro(chalk.red('whiterose') + chalk.dim(' - clear accumulated bugs'));

  // Show current state
  console.log();
  console.log(chalk.bold('  Current accumulated bugs:'));
  console.log(`  Total: ${stats.total}`);
  if (Object.keys(stats.bySeverity).length > 0) {
    console.log('  By severity:');
    for (const [severity, count] of Object.entries(stats.bySeverity)) {
      const color = severity === 'critical' ? 'red' : severity === 'high' ? 'yellow' : 'blue';
      console.log(`    ${chalk[color]('●')} ${severity}: ${count}`);
    }
  }
  console.log(`  Last updated: ${new Date(stats.lastUpdated).toLocaleString()}`);
  console.log();

  // Confirm unless --force
  if (!options.force) {
    const confirm = await p.confirm({
      message: `Clear all ${stats.total} accumulated bugs?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Clear cancelled.');
      process.exit(0);
    }
  }

  // Clear the bugs
  clearAccumulatedBugs(cwd);

  // Also clear SARIF reports (fallback source for fix command)
  const reportsDir = join(whiterosePath, 'reports');
  if (existsSync(reportsDir)) {
    const sarifFiles = readdirSync(reportsDir).filter(f => f.endsWith('.sarif'));
    for (const file of sarifFiles) {
      rmSync(join(reportsDir, file));
    }
    if (sarifFiles.length > 0) {
      p.log.info(`Cleared ${sarifFiles.length} SARIF report(s).`);
    }
  }

  // Clear output directory
  const outputDir = join(cwd, 'whiterose-output');
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true });
    p.log.info('Cleared whiterose-output directory.');
  }

  p.log.success(`Cleared ${stats.total} accumulated bugs.`);
  p.log.info('Run "whiterose scan" to start fresh.');

  p.outro(chalk.green('Done'));
}
