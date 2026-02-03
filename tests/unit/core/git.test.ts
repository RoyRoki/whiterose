import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock execa before importing
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import {
  isGitRepo,
  getCurrentBranch,
  hasUncommittedChanges,
  createFixBranch,
  commitFix,
  stashChanges,
  popStash,
  getDiff,
  getStagedDiff,
  resetFile,
  getFileAtHead,
  getGitStatus,
} from '../../../src/core/git';

const mockBug = {
  id: 'WR-001',
  title: 'Test null reference bug',
  description: 'Potential null dereference',
  file: 'src/test.ts',
  line: 42,
  severity: 'high' as const,
  category: 'null-reference' as const,
  confidence: {
    overall: 'high' as const,
    codePathValidity: 0.9,
    reachability: 0.9,
    intentViolation: false,
    staticToolSignal: true,
    adversarialSurvived: true,
  },
  codePath: [],
  evidence: [],
  createdAt: new Date().toISOString(),
};

describe('core/git', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGitRepo', () => {
    it('should return true when in a git repo', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '.git' } as any);

      const result = await isGitRepo('/test/project');

      expect(result).toBe(true);
      expect(execa).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--git-dir'],
        expect.objectContaining({ cwd: '/test/project' })
      );
    });

    it('should return false when not in a git repo', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('not a git repo'));

      const result = await isGitRepo('/test/project');

      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: 'main\n' } as any);

      const result = await getCurrentBranch('/test/project');

      expect(result).toBe('main');
    });

    it('should return "main" as default when command fails', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('failed'));

      const result = await getCurrentBranch('/test/project');

      expect(result).toBe('main');
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true when there are uncommitted changes', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: 'M src/file.ts\n' } as any);

      const result = await hasUncommittedChanges('/test/project');

      expect(result).toBe(true);
    });

    it('should return false when there are no changes', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

      const result = await hasUncommittedChanges('/test/project');

      expect(result).toBe(false);
    });

    it('should return false when command fails', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('failed'));

      const result = await hasUncommittedChanges('/test/project');

      expect(result).toBe(false);
    });
  });

  describe('createFixBranch', () => {
    it('should create a new branch with generated name', async () => {
      // First call: rev-parse fails (branch doesn't exist)
      // Second call: checkout -b succeeds
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('branch not found'))
        .mockResolvedValueOnce({ stdout: '' } as any);

      const result = await createFixBranch('', mockBug, '/test/project');

      expect(result).toMatch(/^whiterose\/fix-wr-001-test-null-reference-bug/);
      expect(execa).toHaveBeenCalledWith(
        'git',
        ['checkout', '-b', expect.stringMatching(/^whiterose\/fix-/)],
        expect.any(Object)
      );
    });

    it('should checkout existing branch if it exists', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any) // rev-parse succeeds
        .mockResolvedValueOnce({ stdout: '' } as any); // checkout succeeds

      const result = await createFixBranch('existing-branch', mockBug, '/test/project');

      expect(result).toBe('existing-branch');
    });

    it('should throw error when branch creation fails', async () => {
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('branch not found'))
        .mockRejectedValueOnce(new Error('checkout failed'));

      await expect(createFixBranch('', mockBug, '/test/project')).rejects.toThrow(
        'Failed to create branch'
      );
    });
  });

  describe('commitFix', () => {
    it('should stage and commit the fixed file', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any) // git add
        .mockResolvedValueOnce({ stdout: 'src/test.ts\n' } as any) // git diff --cached
        .mockResolvedValueOnce({ stdout: '' } as any) // git commit
        .mockResolvedValueOnce({ stdout: 'abc123\n' } as any); // git rev-parse HEAD

      const result = await commitFix(mockBug, '/test/project');

      expect(result).toBe('abc123');
      expect(execa).toHaveBeenCalledWith(
        'git',
        ['add', 'src/test.ts'],
        expect.any(Object)
      );
    });

    it('should return empty string when no changes to commit', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any) // git add
        .mockResolvedValueOnce({ stdout: '' } as any); // git diff --cached (empty)

      const result = await commitFix(mockBug, '/test/project');

      expect(result).toBe('');
    });
  });

  describe('stashChanges', () => {
    it('should stash changes when there are uncommitted changes', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: 'M file.ts' } as any) // status --porcelain
        .mockResolvedValueOnce({ stdout: '' } as any); // stash push

      const result = await stashChanges('/test/project');

      expect(result).toBe(true);
      expect(execa).toHaveBeenCalledWith(
        'git',
        ['stash', 'push', '-m', 'whiterose: stash before fix'],
        expect.any(Object)
      );
    });

    it('should return false when there are no changes', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as any);

      const result = await stashChanges('/test/project');

      expect(result).toBe(false);
    });
  });

  describe('popStash', () => {
    it('should pop the stash', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as any);

      await popStash('/test/project');

      expect(execa).toHaveBeenCalledWith(
        'git',
        ['stash', 'pop'],
        expect.any(Object)
      );
    });

    it('should throw error when pop fails', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('pop failed'));

      await expect(popStash('/test/project')).rejects.toThrow('Failed to pop stash');
    });
  });

  describe('getDiff', () => {
    it('should return the diff for a file', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '- old\n+ new' } as any);

      const result = await getDiff('src/test.ts', '/test/project');

      expect(result).toBe('- old\n+ new');
    });

    it('should return empty string on error', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('failed'));

      const result = await getDiff('src/test.ts', '/test/project');

      expect(result).toBe('');
    });
  });

  describe('getStagedDiff', () => {
    it('should return the staged diff', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '+ staged change' } as any);

      const result = await getStagedDiff('/test/project');

      expect(result).toBe('+ staged change');
    });

    it('should return empty string on error', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('git diff failed'));

      const result = await getStagedDiff('/test/project');

      expect(result).toBe('');
    });
  });

  describe('resetFile', () => {
    it('should reset a file to HEAD', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as any);

      await resetFile('src/test.ts', '/test/project');

      expect(execa).toHaveBeenCalledWith(
        'git',
        ['checkout', '--', 'src/test.ts'],
        expect.any(Object)
      );
    });

    it('should throw error when reset fails', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('reset failed'));

      await expect(resetFile('src/test.ts', '/test/project')).rejects.toThrow(
        'Failed to reset file'
      );
    });
  });

  describe('getFileAtHead', () => {
    it('should return file content at HEAD', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: 'file content' } as any);

      const result = await getFileAtHead('src/test.ts', '/test/project');

      expect(result).toBe('file content');
    });

    it('should return empty string on error', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('failed'));

      const result = await getFileAtHead('src/test.ts', '/test/project');

      expect(result).toBe('');
    });
  });

  describe('getGitStatus', () => {
    it('should return full git status', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '.git' } as any) // rev-parse
        .mockResolvedValueOnce({ stdout: 'feature-branch\n' } as any) // branch
        .mockResolvedValueOnce({ stdout: 'M  staged.ts\n M modified.ts\n?? untracked.ts' } as any); // status

      const result = await getGitStatus('/test/project');

      expect(result.isRepo).toBe(true);
      expect(result.branch).toBe('feature-branch');
      expect(result.staged).toContain('staged.ts');
      expect(result.modified).toContain('modified.ts');
      expect(result.untracked).toContain('untracked.ts');
    });

    it('should return empty status when not a repo', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('not a repo'));

      const result = await getGitStatus('/test/project');

      expect(result.isRepo).toBe(false);
      expect(result.branch).toBe('');
      expect(result.staged).toEqual([]);
    });

    it('should return default status when git status command fails', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '.git' } as any) // rev-parse succeeds
        .mockResolvedValueOnce({ stdout: 'main\n' } as any) // branch succeeds
        .mockRejectedValueOnce(new Error('status failed')); // status fails

      const result = await getGitStatus('/test/project');

      expect(result.isRepo).toBe(true);
      expect(result.branch).toBe('main');
      expect(result.hasChanges).toBe(false);
      expect(result.staged).toEqual([]);
      expect(result.modified).toEqual([]);
      expect(result.untracked).toEqual([]);
    });
  });
});
