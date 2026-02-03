import { Command } from 'commander';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { existsSync } from 'fs';
import { join } from 'path';
import { initCommand } from './commands/init.js';
import { scanCommand } from './commands/scan.js';
import { fixCommand } from './commands/fix.js';
import { refreshCommand } from './commands/refresh.js';
import { statusCommand } from './commands/status.js';
import { reportCommand } from './commands/report.js';

const BANNER = `
${chalk.red('██╗    ██╗██╗  ██╗██╗████████╗███████╗██████╗  ██████╗ ███████╗███████╗')}
${chalk.red('██║    ██║██║  ██║██║╚══██╔══╝██╔════╝██╔══██╗██╔═══██╗██╔════╝██╔════╝')}
${chalk.red('██║ █╗ ██║███████║██║   ██║   █████╗  ██████╔╝██║   ██║███████╗█████╗  ')}
${chalk.red('██║███╗██║██╔══██║██║   ██║   ██╔══╝  ██╔══██╗██║   ██║╚════██║██╔══╝  ')}
${chalk.red('╚███╔███╔╝██║  ██║██║   ██║   ███████╗██║  ██║╚██████╔╝███████║███████╗')}
${chalk.red(' ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝')}

${chalk.dim('  "I\'ve been staring at your code for a long time."')}
`;

const program = new Command();

program
  .name('whiterose')
  .description('AI-powered bug hunter that uses your existing LLM subscription')
  .version('0.1.0')
  .hook('preAction', () => {
    // Show banner only for main commands, not help
    const args = process.argv.slice(2);
    if (!args.includes('--help') && !args.includes('-h') && args.length > 0) {
      console.log(BANNER);
    }
  });

// ─────────────────────────────────────────────────────────────
// init - First-time setup with intelligent onboarding
// ─────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize whiterose for this project (scans codebase, asks questions, generates config)')
  .option('-p, --provider <provider>', 'LLM provider to use', 'claude-code')
  .option('--skip-questions', 'Skip interactive questions, use defaults')
  .option('--force', 'Overwrite existing .whiterose directory')
  .option('--unsafe', 'Bypass LLM permission prompts (use with caution)')
  .action(initCommand);

// ─────────────────────────────────────────────────────────────
// scan - Find bugs
// ─────────────────────────────────────────────────────────────
program
  .command('scan [paths...]')
  .description('Scan for bugs in the codebase')
  .option('-f, --full', 'Force full scan (ignore cache)')
  .option('--json', 'Output as JSON only')
  .option('--sarif', 'Output as SARIF only')
  .option('-p, --provider <provider>', 'Override LLM provider')
  .option('-c, --category <categories...>', 'Filter by bug categories')
  .option('--min-confidence <level>', 'Minimum confidence level to report', 'low')
  .option('--no-adversarial', 'Skip adversarial validation (faster, less accurate)')
  .option('--unsafe', 'Bypass LLM permission prompts (use with caution)')
  .action(scanCommand);

// ─────────────────────────────────────────────────────────────
// fix - Interactive bug fixing TUI
// ─────────────────────────────────────────────────────────────
program
  .command('fix [bugId]')
  .description('Fix bugs interactively or by ID')
  .option('--dry-run', 'Show proposed fixes without applying')
  .option('--branch <name>', 'Create fixes in a new branch')
  .option('--sarif <path>', 'Load bugs from an external SARIF file')
  .option('--github <url>', 'Load bug from a GitHub issue URL')
  .option('--describe', 'Manually describe a bug to fix')
  .action(fixCommand);

// ─────────────────────────────────────────────────────────────
// refresh - Rebuild understanding from scratch
// ─────────────────────────────────────────────────────────────
program
  .command('refresh')
  .description('Rebuild codebase understanding from scratch')
  .option('--keep-config', 'Keep existing config, only regenerate understanding')
  .action(refreshCommand);

// ─────────────────────────────────────────────────────────────
// status - Show cache and scan status
// ─────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show whiterose status (cache, last scan, provider)')
  .action(statusCommand);

// ─────────────────────────────────────────────────────────────
// report - Generate bug report
// ─────────────────────────────────────────────────────────────
program
  .command('report')
  .description('Generate BUGS.md from last scan')
  .option('-o, --output <path>', 'Output path', 'BUGS.md')
  .option('--format <format>', 'Output format (markdown, sarif, json)', 'markdown')
  .action(reportCommand);

// ─────────────────────────────────────────────────────────────
// Interactive menu when no command provided
// ─────────────────────────────────────────────────────────────
async function showInteractiveMenu(): Promise<void> {
  console.log(BANNER);

  const cwd = process.cwd();
  const whiterosePath = join(cwd, '.whiterose');
  const isInitialized = existsSync(whiterosePath);

  // Show project status
  if (isInitialized) {
    console.log(chalk.dim(`  Project: ${chalk.white(cwd.split('/').pop())}`));
    console.log(chalk.dim(`  Status: ${chalk.green('initialized')}`));
    console.log();
  } else {
    console.log(chalk.dim(`  Project: ${chalk.white(cwd.split('/').pop())}`));
    console.log(chalk.dim(`  Status: ${chalk.yellow('not initialized')}`));
    console.log();
  }

  // Build menu options based on state
  const menuOptions: Array<{ value: string; label: string; hint?: string }> = [];

  if (!isInitialized) {
    menuOptions.push({
      value: 'init',
      label: 'Initialize',
      hint: 'set up whiterose for this project',
    });
  } else {
    menuOptions.push(
      { value: 'scan', label: 'Scan', hint: 'find bugs in the codebase' },
      { value: 'fix', label: 'Fix', hint: 'fix bugs interactively' },
      { value: 'status', label: 'Status', hint: 'show current status' },
      { value: 'report', label: 'Report', hint: 'generate bug report' },
      { value: 'refresh', label: 'Refresh', hint: 'rebuild codebase understanding' }
    );
  }

  menuOptions.push({ value: 'help', label: 'Help', hint: 'show all commands' });
  menuOptions.push({ value: 'exit', label: 'Exit' });

  const choice = await p.select({
    message: 'What would you like to do?',
    options: menuOptions,
  });

  if (p.isCancel(choice) || choice === 'exit') {
    p.outro(chalk.dim('Goodbye.'));
    process.exit(0);
  }

  // Execute chosen command
  console.log(); // Add spacing

  switch (choice) {
    case 'init':
      await initCommand({ provider: 'claude-code', skipQuestions: false, force: false, unsafe: false });
      break;
    case 'scan':
      await scanCommand([], {
        full: false,
        json: false,
        sarif: false,
        provider: undefined,
        category: undefined,
        minConfidence: 'low',
        adversarial: true,
        unsafe: false,
      });
      break;
    case 'fix':
      await fixCommand(undefined, { dryRun: false });
      break;
    case 'status':
      await statusCommand();
      break;
    case 'report':
      await reportCommand({ output: 'BUGS.md', format: 'markdown' });
      break;
    case 'refresh':
      await refreshCommand({ keepConfig: false });
      break;
    case 'help':
      program.help();
      break;
  }
}

// Show interactive menu when no command provided
if (process.argv.length === 2) {
  showInteractiveMenu().catch((error) => {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  });
} else {
  program.parse();
}
