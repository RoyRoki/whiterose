/**
 * Bug Status Manager - Tracks fix status for bugs across scans
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { Bug, BugStatus } from '../types.js';

const STATUS_FILE = '.whiterose/bug-status.json';

interface BugStatusEntry {
  bugId: string;
  file: string;
  line: number;
  title: string;
  status: BugStatus;
  fixedAt?: string;
  fixCommit?: string;
  notes?: string;
}

interface StatusFile {
  version: string;
  bugs: BugStatusEntry[];
}

/**
 * Load bug status from disk
 */
export function loadBugStatus(cwd: string = process.cwd()): StatusFile {
  const statusPath = join(cwd, STATUS_FILE);

  if (!existsSync(statusPath)) {
    return { version: '1', bugs: [] };
  }

  try {
    const content = readFileSync(statusPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate structure to prevent crashes from corrupted files
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.bugs)) {
      return { version: '1', bugs: [] };
    }

    return parsed as StatusFile;
  } catch {
    return { version: '1', bugs: [] };
  }
}

/**
 * Save bug status to disk
 */
export function saveBugStatus(status: StatusFile, cwd: string = process.cwd()): void {
  const statusPath = join(cwd, STATUS_FILE);
  const dir = dirname(statusPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf-8');
}

/**
 * Mark a bug as fixed
 */
export function markBugAsFixed(
  bug: Bug,
  commitHash?: string,
  cwd: string = process.cwd()
): void {
  const status = loadBugStatus(cwd);

  // Find existing entry or create new one
  const existingIndex = status.bugs.findIndex(
    (b) => b.bugId === bug.id || (b.file === bug.file && b.line === bug.line && b.title === bug.title)
  );

  const entry: BugStatusEntry = {
    bugId: bug.id,
    file: bug.file,
    line: bug.line,
    title: bug.title,
    status: 'fixed',
    fixedAt: new Date().toISOString(),
    fixCommit: commitHash,
  };

  if (existingIndex >= 0) {
    status.bugs[existingIndex] = entry;
  } else {
    status.bugs.push(entry);
  }

  saveBugStatus(status, cwd);
}

/**
 * Mark a bug with a specific status
 */
export function updateBugStatus(
  bug: Bug,
  newStatus: BugStatus,
  notes?: string,
  cwd: string = process.cwd()
): void {
  const status = loadBugStatus(cwd);

  const existingIndex = status.bugs.findIndex(
    (b) => b.bugId === bug.id || (b.file === bug.file && b.line === bug.line && b.title === bug.title)
  );

  const entry: BugStatusEntry = {
    bugId: bug.id,
    file: bug.file,
    line: bug.line,
    title: bug.title,
    status: newStatus,
    notes,
    ...(newStatus === 'fixed' ? { fixedAt: new Date().toISOString() } : {}),
  };

  if (existingIndex >= 0) {
    status.bugs[existingIndex] = entry;
  } else {
    status.bugs.push(entry);
  }

  saveBugStatus(status, cwd);
}

/**
 * Get status for a specific bug
 */
export function getBugStatus(bug: Bug, cwd: string = process.cwd()): BugStatusEntry | null {
  const status = loadBugStatus(cwd);

  return status.bugs.find(
    (b) => b.bugId === bug.id || (b.file === bug.file && b.line === bug.line && b.title === bug.title)
  ) || null;
}

/**
 * Apply persisted status to a list of bugs from a scan
 */
export function applyPersistedStatus(bugs: Bug[], cwd: string = process.cwd()): Bug[] {
  const status = loadBugStatus(cwd);

  return bugs.map((bug) => {
    const entry = status.bugs.find(
      (b) => b.bugId === bug.id || (b.file === bug.file && b.line === bug.line && b.title === bug.title)
    );

    if (entry) {
      return {
        ...bug,
        status: entry.status,
        fixedAt: entry.fixedAt,
        fixCommit: entry.fixCommit,
      };
    }

    return bug;
  });
}

/**
 * Get summary of bug statuses
 */
export function getStatusSummary(cwd: string = process.cwd()): Record<BugStatus, number> {
  const status = loadBugStatus(cwd);

  const summary: Record<BugStatus, number> = {
    'open': 0,
    'fixed': 0,
    'false-positive': 0,
    'wont-fix': 0,
  };

  for (const bug of status.bugs) {
    summary[bug.status]++;
  }

  return summary;
}
