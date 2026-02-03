import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { existsSync } from 'fs';
import { execa } from 'execa';
import { runStaticAnalysis } from '../../../src/analysis/static';
import { WhiteroseConfig } from '../../../src/types';

describe('analysis/static', () => {
  const mockConfig: WhiteroseConfig = {
    version: '1',
    provider: 'claude-code',
    include: ['**/*.ts'],
    exclude: ['node_modules'],
    staticAnalysis: {
      typescript: true,
      eslint: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runStaticAnalysis', () => {
    it('should return empty array when no tools configured', async () => {
      const config = {
        ...mockConfig,
        staticAnalysis: {
          typescript: false,
          eslint: false,
        },
      };

      const results = await runStaticAnalysis('/project', ['src/test.ts'], config);

      expect(results).toEqual([]);
    });

    it('should run TypeScript when configured', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.includes('tsconfig.json');
      });
      vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

      const results = await runStaticAnalysis('/project', ['src/test.ts'], mockConfig);

      expect(execa).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['tsc', '--noEmit']),
        expect.any(Object)
      );
    });

    it('should skip TypeScript when no tsconfig.json', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const config = {
        ...mockConfig,
        staticAnalysis: {
          typescript: true,
          eslint: false,
        },
      };

      const results = await runStaticAnalysis('/project', ['src/test.ts'], config);

      expect(results).toEqual([]);
    });

    it('should parse TypeScript errors', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.includes('tsconfig.json');
      });
      vi.mocked(execa).mockRejectedValue({
        stdout: 'src/test.ts(10,5): error TS2322: Type "string" is not assignable to type "number".',
      });

      const config = {
        ...mockConfig,
        staticAnalysis: {
          typescript: true,
          eslint: false,
        },
      };

      const results = await runStaticAnalysis('/project', ['src/test.ts'], config);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tool).toBe('typescript');
      expect(results[0].file).toBe('src/test.ts');
      expect(results[0].line).toBe(10);
    });

    it('should run ESLint when configured', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('tsconfig.json')) return false;
        if (path.includes('.eslintrc')) return true;
        return false;
      });
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          {
            filePath: '/project/src/test.ts',
            messages: [
              {
                line: 5,
                message: 'Unexpected any',
                severity: 2,
                ruleId: '@typescript-eslint/no-explicit-any',
              },
            ],
          },
        ]),
      } as any);

      const config = {
        ...mockConfig,
        staticAnalysis: {
          typescript: false,
          eslint: true,
        },
      };

      const results = await runStaticAnalysis('/project', ['src/test.ts'], config);

      expect(results.length).toBe(1);
      expect(results[0].tool).toBe('eslint');
      expect(results[0].message).toBe('Unexpected any');
    });

    it('should skip ESLint when no config', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const config = {
        ...mockConfig,
        staticAnalysis: {
          typescript: false,
          eslint: true,
        },
      };

      const results = await runStaticAnalysis('/project', ['src/test.ts'], config);

      expect(results).toEqual([]);
    });

    it('should handle ESLint JSON parse errors', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.includes('.eslintrc');
      });
      vi.mocked(execa).mockResolvedValue({ stdout: 'not json' } as any);

      const config = {
        ...mockConfig,
        staticAnalysis: {
          typescript: false,
          eslint: true,
        },
      };

      const results = await runStaticAnalysis('/project', ['src/test.ts'], config);

      expect(results).toEqual([]);
    });

    it('should map ESLint severity correctly', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.includes('.eslintrc');
      });
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          {
            filePath: '/project/src/test.ts',
            messages: [
              { line: 1, message: 'error', severity: 2, ruleId: 'rule1' },
              { line: 2, message: 'warning', severity: 1, ruleId: 'rule2' },
            ],
          },
        ]),
      } as any);

      const config = {
        ...mockConfig,
        staticAnalysis: {
          typescript: false,
          eslint: true,
        },
      };

      const results = await runStaticAnalysis('/project', ['src/test.ts'], config);

      expect(results[0].severity).toBe('error');
      expect(results[1].severity).toBe('warning');
    });
  });
});
