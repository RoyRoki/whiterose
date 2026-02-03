export function generateBugId(index: number): string {
  return `WR-${String(index + 1).padStart(3, '0')}`;
}

export function parseBugId(id: string): number | null {
  const match = id.match(/^WR-(\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10) - 1;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural || `${singular}s`;
}
