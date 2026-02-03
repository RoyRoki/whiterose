import * as p from '@clack/prompts';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { WhiteroseConfig, ScanResult, Bug, ConfidenceLevel } from '../../types.js';
import { loadConfig, loadUnderstanding } from '../../core/config.js';
import { getProvider } from '../../providers/index.js';
import { scanCodebase, getChangedFiles } from '../../core/scanner/index.js';
import { runStaticAnalysis } from '../../analysis/static.js';
import { generateBugId } from '../../core/utils.js';
import { outputSarif } from '../../output/sarif.js';
import { outputMarkdown } from '../../output/markdown.js';
import YAML from 'yaml';

interface ScanOptions {
  full: boolean;
  json: boolean;
  sarif: boolean;
  provider?: string;
  category?: string[];
  minConfidence: string;
  adversarial: boolean;
  unsafe: boolean;
}

export async function scanCommand(paths: string[], options: ScanOptions): Promise<void> {
  const cwd = process.cwd();
  const whiterosePath = join(cwd, '.whiterose');

  // Check if initialized
  if (!existsSync(whiterosePath)) {
    if (!options.json && !options.sarif) {
      p.log.error('whiterose is not initialized in this directory.');
      p.log.info('Run "whiterose init" first.');
    } else {
      console.error(JSON.stringify({ error: 'Not initialized. Run whiterose init first.' }));
    }
    process.exit(1);
  }

  const isQuiet = options.json || options.sarif;

  if (!isQuiet) {
    p.intro(chalk.red('whiterose') + chalk.dim(' - scanning for bugs'));
  }

  // ─────────────────────────────────────────────────────────────
  // Load config and understanding
  // ─────────────────────────────────────────────────────────────
  let config: WhiteroseConfig;
  try {
    config = await loadConfig(cwd);
  } catch (error) {
    if (!isQuiet) p.log.error(`Failed to load config: ${error}`);
    process.exit(1);
  }

  const understanding = await loadUnderstanding(cwd);
  if (!understanding) {
    if (!isQuiet) {
      p.log.error('No codebase understanding found. Run "whiterose refresh" to regenerate.');
    }
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────
  // Determine files to scan
  // ─────────────────────────────────────────────────────────────
  let filesToScan: string[];
  let scanType: 'full' | 'incremental';

  if (options.full || paths.length > 0) {
    scanType = 'full';
    if (!isQuiet) {
      const spinner = p.spinner();
      spinner.start('Scanning files...');
      filesToScan = paths.length > 0 ? paths : await scanCodebase(cwd, config);
      spinner.stop(`Found ${filesToScan.length} files to scan`);
    } else {
      filesToScan = paths.length > 0 ? paths : await scanCodebase(cwd, config);
    }
  } else {
    // Incremental scan
    scanType = 'incremental';
    const changed = await getChangedFiles(cwd, config);
    filesToScan = changed.files;

    if (filesToScan.length === 0) {
      if (!isQuiet) {
        p.log.info('No files changed since last scan. Use --full for a complete scan.');
      } else {
        console.log(JSON.stringify({ bugs: [], message: 'No changes detected' }));
      }
      process.exit(0);
    }

    if (!isQuiet) {
      p.log.info(`Incremental scan: ${filesToScan.length} changed files`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Run static analysis
  // ─────────────────────────────────────────────────────────────
  let staticResults;
  if (!isQuiet) {
    const staticSpinner = p.spinner();
    staticSpinner.start('Running static analysis (tsc, eslint)...');
    staticResults = await runStaticAnalysis(cwd, filesToScan, config);
    staticSpinner.stop(`Static analysis: ${staticResults.length} signals found`);
  } else {
    staticResults = await runStaticAnalysis(cwd, filesToScan, config);
  }

  // ─────────────────────────────────────────────────────────────
  // LLM Analysis
  // ─────────────────────────────────────────────────────────────
  const providerName = options.provider || config.provider;
  const provider = await getProvider(providerName as any);

  // Enable unsafe mode if requested (bypasses LLM permission prompts)
  if (options.unsafe) {
    if ('setUnsafeMode' in provider) {
      (provider as any).setUnsafeMode(true);
      if (!isQuiet) {
        p.log.warn('Running in unsafe mode (--unsafe). LLM permission prompts are bypassed.');
      }
    }
  }

  let bugs: Bug[];
  if (!isQuiet) {
    const llmSpinner = p.spinner();
    const analysisStartTime = Date.now();
    llmSpinner.start(`Analyzing with ${providerName}... (this may take 1-2 minutes)`);

    // Update spinner with elapsed time every 5 seconds
    const analysisTimeInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - analysisStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      llmSpinner.message(`Analyzing with ${providerName}... (${timeStr} elapsed)`);
    }, 5000);

    try {
      bugs = await provider.analyze({
        files: filesToScan,
        understanding,
        config,
        staticAnalysisResults: staticResults,
      });
      clearInterval(analysisTimeInterval);
      const totalTime = Math.floor((Date.now() - analysisStartTime) / 1000);
      llmSpinner.stop(`Found ${bugs.length} potential bugs (${totalTime}s)`);
    } catch (error) {
      clearInterval(analysisTimeInterval);
      llmSpinner.stop('Analysis failed');
      p.log.error(String(error));
      process.exit(1);
    }
  } else {
    bugs = await provider.analyze({
      files: filesToScan,
      understanding,
      config,
      staticAnalysisResults: staticResults,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Adversarial validation
  // ─────────────────────────────────────────────────────────────
  if (options.adversarial && bugs.length > 0) {
    if (!isQuiet) {
      const advSpinner = p.spinner();
      advSpinner.start('Running adversarial validation...');

      const validatedBugs: Bug[] = [];
      for (const bug of bugs) {
        const result = await provider.adversarialValidate(bug, {
          files: filesToScan,
          understanding,
          config,
          staticAnalysisResults: staticResults,
        });

        if (result.survived) {
          validatedBugs.push({
            ...bug,
            confidence: result.adjustedConfidence || bug.confidence,
          });
        }
      }

      const filtered = bugs.length - validatedBugs.length;
      advSpinner.stop(`Adversarial validation: ${filtered} false positives filtered`);
      bugs = validatedBugs;
    } else {
      const validatedBugs: Bug[] = [];
      for (const bug of bugs) {
        const result = await provider.adversarialValidate(bug, {
          files: filesToScan,
          understanding,
          config,
          staticAnalysisResults: staticResults,
        });
        if (result.survived) {
          validatedBugs.push({
            ...bug,
            confidence: result.adjustedConfidence || bug.confidence,
          });
        }
      }
      bugs = validatedBugs;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Filter by confidence
  // ─────────────────────────────────────────────────────────────
  const minConfidence = options.minConfidence as ConfidenceLevel;
  const confidenceOrder = { high: 3, medium: 2, low: 1 };
  bugs = bugs.filter((bug) => confidenceOrder[bug.confidence.overall] >= confidenceOrder[minConfidence]);

  // ─────────────────────────────────────────────────────────────
  // Filter by category
  // ─────────────────────────────────────────────────────────────
  if (options.category && options.category.length > 0) {
    bugs = bugs.filter((bug) => options.category!.includes(bug.category));
  }

  // ─────────────────────────────────────────────────────────────
  // Assign IDs
  // ─────────────────────────────────────────────────────────────
  bugs = bugs.map((bug, index) => ({
    ...bug,
    id: bug.id || generateBugId(index),
  }));

  // ─────────────────────────────────────────────────────────────
  // Create scan result
  // ─────────────────────────────────────────────────────────────
  const result: ScanResult = {
    id: `scan-${Date.now()}`,
    timestamp: new Date().toISOString(),
    scanType,
    filesScanned: filesToScan.length,
    filesChanged: scanType === 'incremental' ? filesToScan.length : undefined,
    duration: 0, // TODO: track actual duration
    bugs,
    summary: {
      critical: bugs.filter((b) => b.severity === 'critical').length,
      high: bugs.filter((b) => b.severity === 'high').length,
      medium: bugs.filter((b) => b.severity === 'medium').length,
      low: bugs.filter((b) => b.severity === 'low').length,
      total: bugs.length,
    },
  };

  // ─────────────────────────────────────────────────────────────
  // Output
  // ─────────────────────────────────────────────────────────────
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.sarif) {
    console.log(JSON.stringify(outputSarif(result), null, 2));
  } else {
    // Save SARIF report
    if (config.output.sarif) {
      const sarifPath = join(whiterosePath, 'reports', `${new Date().toISOString().split('T')[0]}.sarif`);
      writeFileSync(sarifPath, JSON.stringify(outputSarif(result), null, 2));
    }

    // Generate markdown
    if (config.output.markdown) {
      const markdown = outputMarkdown(result);
      writeFileSync(join(cwd, config.output.markdownPath), markdown);
    }

    // Show summary
    console.log();
    p.log.message(chalk.bold('Scan Results'));
    console.log();
    console.log(`  ${chalk.red('●')} Critical: ${result.summary.critical}`);
    console.log(`  ${chalk.yellow('●')} High: ${result.summary.high}`);
    console.log(`  ${chalk.blue('●')} Medium: ${result.summary.medium}`);
    console.log(`  ${chalk.dim('●')} Low: ${result.summary.low}`);
    console.log();
    console.log(`  ${chalk.bold('Total:')} ${result.summary.total} bugs found`);
    console.log();

    if (result.summary.total > 0) {
      p.log.info(`Run ${chalk.cyan('whiterose fix')} to fix bugs interactively.`);
    }

    p.outro(chalk.green('Scan complete'));
  }
}
