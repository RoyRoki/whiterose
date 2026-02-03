import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdtempSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('../../../src/providers/detect', () => ({
  isProviderAvailable: vi.fn(),
}));

import { execa } from 'execa';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { AiderProvider } from '../../../src/providers/adapters/aider';
import { isProviderAvailable } from '../../../src/providers/detect';
import { CodebaseUnderstanding } from '../../../src/types';

describe('providers/adapters/aider', () => {
  let provider: AiderProvider;

  const mockUnderstanding: CodebaseUnderstanding = {
    version: '1',
    generatedAt: '2024-01-01T00:00:00Z',
    summary: {
      type: 'api',
      framework: 'express',
      language: 'typescript',
      description: 'Test API',
    },
    features: [],
    contracts: [],
    dependencies: {},
    structure: {
      totalFiles: 10,
      totalLines: 1000,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AiderProvider();
    vi.mocked(mkdtempSync).mockReturnValue('/tmp/whiterose-test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      expect(provider).toBeDefined();
    });

    it('should have name aider', () => {
      expect(provider.name).toBe('aider');
    });
  });

  describe('detect', () => {
    it('should return true when aider CLI is available', async () => {
      vi.mocked(isProviderAvailable).mockResolvedValue(true);

      const result = await provider.detect();

      expect(result).toBe(true);
      expect(isProviderAvailable).toHaveBeenCalledWith('aider');
    });

    it('should return false when aider CLI is not available', async () => {
      vi.mocked(isProviderAvailable).mockResolvedValue(false);

      const result = await provider.detect();

      expect(result).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('should return true when aider CLI is available', async () => {
      vi.mocked(isProviderAvailable).mockResolvedValue(true);

      const result = await provider.isAvailable();

      expect(result).toBe(true);
    });

    it('should return false when aider CLI is not available', async () => {
      vi.mocked(isProviderAvailable).mockResolvedValue(false);

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should return empty array for empty file list', async () => {
      const bugs = await provider.analyze({
        files: [],
        cwd: '/test',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs).toEqual([]);
    });

    it('should analyze files and return bugs', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          {
            file: 'src/test.ts',
            line: 10,
            title: 'Null dereference',
            description: 'Accessing property on null',
            severity: 'high',
            category: 'null-reference',
            codePath: [{ step: 1, file: 'src/test.ts', line: 10, code: 'x.foo', explanation: 'x may be null' }],
            evidence: ['No null check'],
            suggestedFix: 'if (x) { x.foo }',
          },
        ]),
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs.length).toBe(1);
      expect(bugs[0].title).toBe('Null dereference');
      expect(bugs[0].severity).toBe('high');
    });

    it('should handle invalid JSON response', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: 'not json', stderr: '' } as any);

      const bugs = await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs).toEqual([]);
    });

    it('should throw error when aider not found', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockRejectedValue({ message: 'ENOENT' });

      await expect(
        provider.analyze({
          files: ['/project/src/test.ts'],
          cwd: '/project',
          understanding: mockUnderstanding,
          staticAnalysisResults: [],
        })
      ).rejects.toThrow('Aider not found');
    });

    it('should clean up temp files after analysis', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: '[]', stderr: '' } as any);

      await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(rmSync).toHaveBeenCalledWith('/tmp/whiterose-test', { recursive: true, force: true });
    });

    it('should clean up temp files even on error', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockRejectedValue({ message: 'Some error' });

      await expect(
        provider.analyze({
          files: ['/project/src/test.ts'],
          cwd: '/project',
          understanding: mockUnderstanding,
          staticAnalysisResults: [],
        })
      ).rejects.toThrow();

      expect(rmSync).toHaveBeenCalled();
    });

    it('should use stderr when stdout is empty', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: JSON.stringify([{ file: 'test.ts', line: 1, title: 'Bug from stderr' }]),
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs.length).toBe(1);
      expect(bugs[0].title).toBe('Bug from stderr');
    });

    it('should include static analysis signals', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: '[]', stderr: '' } as any);

      await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [
          { tool: 'eslint', file: 'test.ts', line: 5, message: 'Warning', severity: 'warning' },
        ],
      });

      expect(execa).toHaveBeenCalled();
    });

    it('should parse severity correctly', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          { file: 'test.ts', line: 1, title: 'Bug 1', severity: 'critical', category: 'logic-error' },
          { file: 'test.ts', line: 2, title: 'Bug 2', severity: 'low', category: 'logic-error' },
          { file: 'test.ts', line: 3, title: 'Bug 3', severity: 'invalid', category: 'logic-error' },
        ]),
        stderr: '',
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs[0].severity).toBe('critical');
      expect(bugs[1].severity).toBe('low');
      expect(bugs[2].severity).toBe('medium');
    });

    it('should parse category correctly', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          { file: 'test.ts', line: 1, title: 'Bug', severity: 'high', category: 'null' },
          { file: 'test.ts', line: 2, title: 'Bug', severity: 'high', category: 'security' },
          { file: 'test.ts', line: 3, title: 'Bug', severity: 'high', category: 'race' },
        ]),
        stderr: '',
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs[0].category).toBe('null-reference');
      expect(bugs[1].category).toBe('security');
      expect(bugs[2].category).toBe('async-race-condition');
    });

    it('should default to logic-error for unknown categories', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          { file: 'test.ts', line: 1, title: 'Bug', severity: 'high', category: 'unknown-category' },
        ]),
        stderr: '',
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs[0].category).toBe('logic-error');
    });

    it('should return medium confidence for bugs by default', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          { file: 'test.ts', line: 1, title: 'Bug', severity: 'high', category: 'logic-error' },
        ]),
        stderr: '',
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs[0].confidence.overall).toBe('medium');
    });

    it('should limit files to 10', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: '[]', stderr: '' } as any);

      const files = Array.from({ length: 20 }, (_, i) => `/project/src/file${i}.ts`);

      await provider.analyze({
        files,
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      // Aider args should include at most 10 files
      const args = vi.mocked(execa).mock.calls[0][1] as string[];
      const fileArgs = args.filter((a) => a.includes('.ts'));
      expect(fileArgs.length).toBeLessThanOrEqual(10);
    });
  });

  describe('adversarialValidate', () => {
    const mockBug = {
      id: 'WR-001',
      title: 'Null dereference',
      description: 'x may be null',
      file: '/project/src/test.ts',
      line: 10,
      severity: 'high' as const,
      category: 'null-reference' as const,
      confidence: {
        overall: 'medium' as const,
        codePathValidity: 0.8,
        reachability: 0.8,
        intentViolation: false,
        staticToolSignal: false,
        adversarialSurvived: false,
      },
      codePath: [{ step: 1, file: '/project/src/test.ts', line: 10, code: 'x.foo', explanation: 'x may be null' }],
      evidence: ['No null check'],
      createdAt: '2024-01-01T00:00:00Z',
    };

    it('should return survived true when bug cannot be disproved', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = null; x.foo;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify({
          survived: true,
          counterArguments: [],
          confidence: 'high',
        }),
        stderr: '',
      } as any);

      const result = await provider.adversarialValidate(mockBug, {
        files: [],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(result.survived).toBe(true);
    });

    it('should handle disproved bug with counterArguments', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('if (x) { x.foo; }');
      vi.mocked(execa).mockResolvedValue({
        stdout: '{"survived": false, "counterArguments": ["There is a null check"], "confidence": "high"}',
        stderr: '',
      } as any);

      const result = await provider.adversarialValidate(mockBug, {
        files: [],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      // Verify response structure
      expect(result).toHaveProperty('survived');
      expect(result).toHaveProperty('counterArguments');
    });

    it('should return survived true on parse error', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: 'not json', stderr: '' } as any);

      const result = await provider.adversarialValidate(mockBug, {
        files: [],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(result.survived).toBe(true);
    });

    it('should include adjusted confidence when survived', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: '{"survived": true, "counterArguments": [], "confidence": "high"}',
        stderr: '',
      } as any);

      const result = await provider.adversarialValidate(mockBug, {
        files: [],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(result.survived).toBe(true);
      if (result.adjustedConfidence) {
        expect(result.adjustedConfidence.adversarialSurvived).toBe(true);
      }
    });
  });

  describe('generateUnderstanding', () => {
    it('should call execa with understanding prompt', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: '{"summary": {"type": "api", "language": "typescript", "description": "API"}, "features": [], "contracts": []}',
        stderr: '',
      } as any);

      await provider.generateUnderstanding(['/project/src/index.ts']);

      expect(execa).toHaveBeenCalledWith('aider', expect.any(Array), expect.any(Object));
    });

    it('should handle parse errors gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: 'not json', stderr: '' } as any);

      const understanding = await provider.generateUnderstanding(['/project/src/index.ts']);

      expect(understanding.summary.type).toBe('unknown');
      expect(understanding.summary.description).toContain('Failed to analyze');
    });

    it('should prioritize important files', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: '{"summary": {"type": "app", "language": "typescript", "description": "App"}, "features": [], "contracts": []}',
        stderr: '',
      } as any);

      const files = Array.from({ length: 50 }, (_, i) => `/project/src/file${i}.ts`);
      files.unshift('/project/package.json');

      await provider.generateUnderstanding(files);

      expect(execa).toHaveBeenCalled();
    });

    it('should handle package.json parse errors', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) {
          return 'invalid json';
        }
        return 'const x = 1;';
      });
      vi.mocked(execa).mockResolvedValue({
        stdout: '{"summary": {"type": "app", "language": "typescript", "description": "App"}, "features": [], "contracts": []}',
        stderr: '',
      } as any);

      const understanding = await provider.generateUnderstanding([
        '/project/package.json',
        '/project/src/index.ts',
      ]);

      expect(understanding).toBeDefined();
    });
  });
});
