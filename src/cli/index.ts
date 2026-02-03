import { Command } from 'commander';
import chalk from 'chalk';
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
  .action(scanCommand);

// ─────────────────────────────────────────────────────────────
// fix - Interactive bug fixing TUI
// ─────────────────────────────────────────────────────────────
program
  .command('fix [bugId]')
  .description('Fix bugs interactively or by ID')
  .option('--dry-run', 'Show proposed fixes without applying')
  .option('--branch <name>', 'Create fixes in a new branch')
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

// Show banner when no command provided
if (process.argv.length === 2) {
  console.log(BANNER);
  program.help();
}

program.parse();
