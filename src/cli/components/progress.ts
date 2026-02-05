/**
 * Progress bar and duration formatting utilities for CLI output
 */

/**
 * Format milliseconds into human-readable duration
 * Examples: "45s", "2m 30s", "1h 15m"
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (mins > 0) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  return `${secs}s`;
}

/**
 * Render an ASCII progress bar
 * @param progress - Value between 0 and 1
 * @param width - Total width of the bar (excluding brackets)
 */
export function renderProgressBar(progress: number, width: number = 10): string {
  const clamped = Math.max(0, Math.min(1, progress));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  return '[' + '\u2588'.repeat(filled) + '\u2591'.repeat(empty) + ']';
}

/**
 * Phase tracking for multi-phase scans
 */
export interface PhaseProgress {
  name: string;
  current: number;
  total: number;
}

/**
 * Render phase progress line
 * Example: "Phase 1: Unit Analysis      [████████░░] 80%  (6/6 passes)"
 */
export function renderPhaseProgress(phase: PhaseProgress, index: number, padName: number = 20): string {
  const progress = phase.total > 0 ? phase.current / phase.total : 0;
  const percent = Math.round(progress * 100);
  const bar = renderProgressBar(progress);
  const paddedName = phase.name.padEnd(padName);
  return `Phase ${index + 1}: ${paddedName} ${bar} ${String(percent).padStart(3)}%  (${phase.current}/${phase.total} passes)`;
}

/**
 * Count lines of code in file contents
 */
export function countLinesOfCode(contents: string[]): number {
  return contents.reduce((total, content) => {
    // Count non-empty, non-comment lines
    const lines = content.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 &&
             !trimmed.startsWith('//') &&
             !trimmed.startsWith('/*') &&
             !trimmed.startsWith('*');
    });
    return total + lines.length;
  }, 0);
}
