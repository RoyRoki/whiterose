import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('../../../src/core/git', () => ({
  createFixBranch: vi.fn(),
  commitFix: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execa } from 'execa';
import { createFixBranch, commitFix } from '../../../src/core/git';
import { applyFix, batchFix } from '../../../src/core/fixer';
import { Bug, WhiteroseConfig } from '../../../src/types';

const mockBug: Bug = {
  id: 'WR-001',
  title: 'Null reference bug',
  description: 'Potential null dereference at line 5',
  file: '/project/src/test.ts',
  line: 5,
  severity: 'high',
  category: 'null-reference',
  confidence: {
    overall: 'high',
    codePathValidity: 0.9,
    reachability: 0.9,
    intentViolation: false,
    staticToolSignal: true,
    adversarialSurvived: true,
  },
  codePath: [
    {
      step: 1,
      file: '/project/src/test.ts',
      line: 3,
      code: 'const user = await findUser(id);',
      explanation: 'User may be null',
    },
    {
      step: 2,
      file: '/project/src/test.ts',
      line: 5,
      code: 'return user.name;',
      explanation: 'Dereference without null check',
    },
  ],
  evidence: ['No null check before access'],
  suggestedFix: 'return user?.name ?? "Unknown";',
  createdAt: new Date().toISOString(),
};

const mockConfig: WhiteroseConfig = {
  version: '1',
  provider: 'claude-code',
  include: ['**/*.ts'],
  exclude: ['node_modules'],
};

describe('core/fixer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyFix', () => {
    it('should return error when file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await applyFix(mockBug, mockConfig, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should apply simple fix with suggested fix', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`const user = await findUser(id);
const name = user.name;
console.log(name);
// comment
return user.name;
// more code`);

      vi.mocked(writeFileSync).mockReturnValue(undefined);
      vi.mocked(commitFix).mockResolvedValue('abc123');

      const result = await applyFix(mockBug, mockConfig, { dryRun: false });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
      expect(writeFileSync).toHaveBeenCalled();
      expect(commitFix).toHaveBeenCalled();
    });

    it('should show diff but not write in dry run mode', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`const user = await findUser(id);
const name = user.name;
console.log(name);
// comment
return user.name;`);

      const result = await applyFix(mockBug, mockConfig, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(commitFix).not.toHaveBeenCalled();
    });

    it('should create branch when branch option is provided', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`line 1
line 2
line 3
line 4
return user.name;`);
      vi.mocked(writeFileSync).mockReturnValue(undefined);
      vi.mocked(createFixBranch).mockResolvedValue('fix/wr-001');
      vi.mocked(commitFix).mockResolvedValue('abc123');

      const result = await applyFix(mockBug, mockConfig, {
        dryRun: false,
        branch: 'fix/wr-001',
      });

      expect(result.success).toBe(true);
      expect(result.branchName).toBe('fix/wr-001');
      expect(createFixBranch).toHaveBeenCalledWith('fix/wr-001', mockBug);
    });

    it('should fall back to LLM fix when no suggested fix', async () => {
      const bugWithoutSuggestion = {
        ...mockBug,
        suggestedFix: undefined,
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`const user = await findUser(id);
return user.name;`);

      vi.mocked(execa).mockResolvedValue({
        stdout: '```typescript\nconst user = await findUser(id);\nreturn user?.name ?? "Unknown";\n```',
      } as any);

      vi.mocked(writeFileSync).mockReturnValue(undefined);
      vi.mocked(commitFix).mockResolvedValue('abc123');

      const result = await applyFix(bugWithoutSuggestion, mockConfig, { dryRun: false });

      expect(result.success).toBe(true);
      expect(execa).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', expect.any(String)]),
        expect.any(Object)
      );
    });

    it('should return error when LLM fix fails to parse', async () => {
      const bugWithoutSuggestion = {
        ...mockBug,
        suggestedFix: undefined,
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('original code');
      vi.mocked(execa).mockResolvedValue({
        stdout: 'Sorry, I cannot fix this code.',
      } as any);

      const result = await applyFix(bugWithoutSuggestion, mockConfig, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse fix');
    });

    it('should handle LLM execution error', async () => {
      const bugWithoutSuggestion = {
        ...mockBug,
        suggestedFix: undefined,
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('original code');
      vi.mocked(execa).mockRejectedValue(new Error('Claude CLI not found'));

      const result = await applyFix(bugWithoutSuggestion, mockConfig, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude CLI not found');
    });

    it('should extract code from LLM response without code blocks', async () => {
      const bugWithoutSuggestion = {
        ...mockBug,
        suggestedFix: undefined,
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const user = findUser(id);\nreturn user.name;');

      // Response without code blocks but looks like code
      vi.mocked(execa).mockResolvedValue({
        stdout: 'const user = findUser(id);\nreturn user?.name ?? "Unknown";',
      } as any);

      vi.mocked(writeFileSync).mockReturnValue(undefined);
      vi.mocked(commitFix).mockResolvedValue('abc123');

      const result = await applyFix(bugWithoutSuggestion, mockConfig, { dryRun: false });

      expect(result.success).toBe(true);
    });

  });

  describe('batchFix', () => {
    it('should fix multiple bugs', async () => {
      const bugs: Bug[] = [
        { ...mockBug, id: 'WR-001', file: '/project/src/a.ts' },
        { ...mockBug, id: 'WR-002', file: '/project/src/b.ts' },
      ];

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`line 1
line 2
line 3
line 4
return user.name;`);
      vi.mocked(writeFileSync).mockReturnValue(undefined);
      vi.mocked(commitFix).mockResolvedValue('abc123');

      const results = await batchFix(bugs, mockConfig, { dryRun: false });

      expect(results.size).toBe(2);
      expect(results.get('WR-001')?.success).toBe(true);
      expect(results.get('WR-002')?.success).toBe(true);
    });

    it('should stop on first failure in non-dry-run mode', async () => {
      const bugs: Bug[] = [
        { ...mockBug, id: 'WR-001', file: '/project/src/missing.ts' },
        { ...mockBug, id: 'WR-002', file: '/project/src/b.ts' },
      ];

      vi.mocked(existsSync).mockImplementation((path: any) => {
        return !path.includes('missing.ts');
      });

      const results = await batchFix(bugs, mockConfig, { dryRun: false });

      expect(results.size).toBe(1);
      expect(results.get('WR-001')?.success).toBe(false);
      expect(results.has('WR-002')).toBe(false); // Second bug not attempted
    });

    it('should continue on failure in dry-run mode', async () => {
      const bugs: Bug[] = [
        { ...mockBug, id: 'WR-001', file: '/project/src/missing.ts' },
        { ...mockBug, id: 'WR-002', file: '/project/src/b.ts' },
      ];

      vi.mocked(existsSync).mockImplementation((path: any) => {
        return !path.includes('missing.ts');
      });
      vi.mocked(readFileSync).mockReturnValue(`line 1
line 2
line 3
line 4
return user.name;`);

      const results = await batchFix(bugs, mockConfig, { dryRun: true });

      expect(results.size).toBe(2);
      expect(results.get('WR-001')?.success).toBe(false);
      expect(results.get('WR-002')?.success).toBe(true);
    });

    it('should handle empty bug list', async () => {
      const results = await batchFix([], mockConfig, { dryRun: false });

      expect(results.size).toBe(0);
    });
  });
});
