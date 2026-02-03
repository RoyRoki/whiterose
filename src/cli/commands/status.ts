import * as p from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { loadConfig, loadUnderstanding } from '../../core/config.js';
import { detectProvider } from '../../providers/detect.js';

export async function statusCommand(): Promise<void> {
  const cwd = process.cwd();
  const whiterosePath = join(cwd, '.whiterose');

  // Check if initialized
  if (!existsSync(whiterosePath)) {
    p.log.error('whiterose is not initialized in this directory.');
    p.log.info('Run "whiterose init" first.');
    process.exit(1);
  }

  p.intro(chalk.red('whiterose') + chalk.dim(' - status'));

  // Load config
  const config = await loadConfig(cwd);
  const understanding = await loadUnderstanding(cwd);

  // Detect available providers
  const availableProviders = await detectProvider();

  console.log();
  console.log(chalk.bold('  Configuration'));
  console.log(`  ${chalk.dim('Provider:')} ${config.provider}`);
  console.log(`  ${chalk.dim('Available:')} ${availableProviders.join(', ') || 'none'}`);
  console.log();

  if (understanding) {
    console.log(chalk.bold('  Codebase Understanding'));
    console.log(`  ${chalk.dim('Type:')} ${understanding.summary.type}`);
    console.log(`  ${chalk.dim('Framework:')} ${understanding.summary.framework || 'none'}`);
    console.log(`  ${chalk.dim('Files:')} ${understanding.structure.totalFiles}`);
    console.log(`  ${chalk.dim('Features:')} ${understanding.features.length}`);
    console.log(`  ${chalk.dim('Contracts:')} ${understanding.contracts.length}`);
    console.log(`  ${chalk.dim('Generated:')} ${understanding.generatedAt}`);
    console.log();
  }

  // Check cache status
  const hashesPath = join(whiterosePath, 'cache', 'file-hashes.json');
  if (existsSync(hashesPath)) {
    const hashes = JSON.parse(readFileSync(hashesPath, 'utf-8'));
    console.log(chalk.bold('  Cache'));
    console.log(`  ${chalk.dim('Files tracked:')} ${hashes.fileHashes?.length || 0}`);
    console.log(`  ${chalk.dim('Last full scan:')} ${hashes.lastFullScan || 'never'}`);
    console.log();
  }

  // Check reports
  const reportsDir = join(whiterosePath, 'reports');
  if (existsSync(reportsDir)) {
    const reports = readdirSync(reportsDir).filter((f) => f.endsWith('.sarif'));
    if (reports.length > 0) {
      const latestReport = reports.sort().reverse()[0];
      const reportPath = join(reportsDir, latestReport);
      const stats = statSync(reportPath);

      console.log(chalk.bold('  Last Scan'));
      console.log(`  ${chalk.dim('Report:')} ${latestReport}`);
      console.log(`  ${chalk.dim('Date:')} ${stats.mtime.toISOString()}`);

      // Try to get bug count from report
      try {
        const sarif = JSON.parse(readFileSync(reportPath, 'utf-8'));
        const bugCount = sarif.runs?.[0]?.results?.length || 0;
        console.log(`  ${chalk.dim('Bugs found:')} ${bugCount}`);
      } catch {
        // Ignore parse errors
      }
      console.log();
    }
  }

  p.outro(chalk.dim('Run "whiterose scan" to scan for bugs'));
}
