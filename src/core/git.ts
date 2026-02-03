import { execa } from 'execa';
import { Bug } from '../types.js';

const GIT_TIMEOUT = 30000; // 30 seconds

export async function isGitRepo(cwd: string = process.cwd()): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--git-dir'], { cwd, timeout: GIT_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execa('git', ['branch', '--show-current'], {
      cwd,
      timeout: GIT_TIMEOUT,
    });
    return stdout.trim();
  } catch {
    return 'main';
  }
}

export async function hasUncommittedChanges(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const { stdout } = await execa('git', ['status', '--porcelain'], {
      cwd,
      timeout: GIT_TIMEOUT,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function createFixBranch(
  branchName: string,
  bug: Bug,
  cwd: string = process.cwd()
): Promise<string> {
  // Generate branch name from bug info if not provided
  const safeBugId = bug.id.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const safeTitle = bug.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30);

  const fullBranchName = branchName || `whiterose/fix-${safeBugId}-${safeTitle}`;

  try {
    // Check if branch already exists
    try {
      await execa('git', ['rev-parse', '--verify', fullBranchName], {
        cwd,
        timeout: GIT_TIMEOUT,
      });
      // Branch exists, check it out
      await execa('git', ['checkout', fullBranchName], { cwd, timeout: GIT_TIMEOUT });
    } catch {
      // Branch doesn't exist, create it
      await execa('git', ['checkout', '-b', fullBranchName], { cwd, timeout: GIT_TIMEOUT });
    }

    return fullBranchName;
  } catch (error: any) {
    throw new Error(`Failed to create branch: ${error.message}`);
  }
}

export async function commitFix(bug: Bug, cwd: string = process.cwd()): Promise<string> {
  try {
    // Stage the changed file
    await execa('git', ['add', bug.file], { cwd, timeout: GIT_TIMEOUT });

    // Check if there are staged changes
    const { stdout: diff } = await execa('git', ['diff', '--cached', '--name-only'], {
      cwd,
      timeout: GIT_TIMEOUT,
    });

    if (!diff.trim()) {
      return ''; // No changes to commit
    }

    // Create commit message
    const commitMessage = `fix(${bug.category}): ${bug.title}

Bug ID: ${bug.id}
File: ${bug.file}:${bug.line}
Severity: ${bug.severity}

${bug.description}

Fixed by whiterose`;

    // Commit
    await execa('git', ['commit', '-m', commitMessage], {
      cwd,
      timeout: GIT_TIMEOUT,
    });

    // Get the commit hash
    const { stdout: hash } = await execa('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeout: GIT_TIMEOUT,
    });

    return hash.trim();
  } catch (error: any) {
    throw new Error(`Failed to commit fix: ${error.message}`);
  }
}

export async function stashChanges(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const hasChanges = await hasUncommittedChanges(cwd);
    if (!hasChanges) {
      return false;
    }

    await execa('git', ['stash', 'push', '-m', 'whiterose: stash before fix'], {
      cwd,
      timeout: GIT_TIMEOUT,
    });

    return true;
  } catch (error: any) {
    throw new Error(`Failed to stash changes: ${error.message}`);
  }
}

export async function popStash(cwd: string = process.cwd()): Promise<void> {
  try {
    await execa('git', ['stash', 'pop'], { cwd, timeout: GIT_TIMEOUT });
  } catch (error: any) {
    throw new Error(`Failed to pop stash: ${error.message}`);
  }
}

export async function getDiff(file: string, cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execa('git', ['diff', file], { cwd, timeout: GIT_TIMEOUT });
    return stdout;
  } catch {
    return '';
  }
}

export async function getStagedDiff(cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execa('git', ['diff', '--cached'], { cwd, timeout: GIT_TIMEOUT });
    return stdout;
  } catch {
    return '';
  }
}

export async function resetFile(file: string, cwd: string = process.cwd()): Promise<void> {
  try {
    await execa('git', ['checkout', '--', file], { cwd, timeout: GIT_TIMEOUT });
  } catch (error: any) {
    throw new Error(`Failed to reset file: ${error.message}`);
  }
}

export async function getFileAtHead(file: string, cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execa('git', ['show', `HEAD:${file}`], {
      cwd,
      timeout: GIT_TIMEOUT,
    });
    return stdout;
  } catch {
    return '';
  }
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  hasChanges: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export async function getGitStatus(cwd: string = process.cwd()): Promise<GitStatus> {
  const isRepo = await isGitRepo(cwd);
  if (!isRepo) {
    return {
      isRepo: false,
      branch: '',
      hasChanges: false,
      staged: [],
      modified: [],
      untracked: [],
    };
  }

  const branch = await getCurrentBranch(cwd);

  try {
    const { stdout } = await execa('git', ['status', '--porcelain'], {
      cwd,
      timeout: GIT_TIMEOUT,
    });

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;

      const status = line.slice(0, 2);
      const file = line.slice(3);

      if (status[0] !== ' ' && status[0] !== '?') {
        staged.push(file);
      }
      if (status[1] === 'M') {
        modified.push(file);
      }
      if (status === '??') {
        untracked.push(file);
      }
    }

    return {
      isRepo: true,
      branch,
      hasChanges: staged.length > 0 || modified.length > 0,
      staged,
      modified,
      untracked,
    };
  } catch {
    return {
      isRepo: true,
      branch,
      hasChanges: false,
      staged: [],
      modified: [],
      untracked: [],
    };
  }
}
