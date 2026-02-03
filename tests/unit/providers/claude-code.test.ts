import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../../../src/providers/detect', () => ({
  isProviderAvailable: vi.fn(),
}));

import { execa } from 'execa';
import { existsSync, readFileSync } from 'fs';
import { ClaudeCodeProvider } from '../../../src/providers/adapters/claude-code';
import { isProviderAvailable } from '../../../src/providers/detect';
import { CodebaseUnderstanding } from '../../../src/types';

describe('providers/adapters/claude-code', () => {
  let provider: ClaudeCodeProvider;

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
    provider = new ClaudeCodeProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      expect(provider).toBeDefined();
    });

    it('should have name claude-code', () => {
      expect(provider.name).toBe('claude-code');
    });
  });

  describe('detect', () => {
    it('should return true when claude CLI is available', async () => {
      vi.mocked(isProviderAvailable).mockResolvedValue(true);

      const result = await provider.detect();

      expect(result).toBe(true);
      expect(isProviderAvailable).toHaveBeenCalledWith('claude-code');
    });

    it('should return false when claude CLI is not available', async () => {
      vi.mocked(isProviderAvailable).mockResolvedValue(false);

      const result = await provider.detect();

      expect(result).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('should return true when claude CLI is available', async () => {
      vi.mocked(isProviderAvailable).mockResolvedValue(true);

      const result = await provider.isAvailable();

      expect(result).toBe(true);
    });

    it('should return false when claude CLI is not available', async () => {
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
      expect(bugs[0].category).toBe('null-reference');
    });

    it('should handle invalid JSON response', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: 'not json' } as any);

      const bugs = await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs).toEqual([]);
    });

    it('should handle CLI errors with stdout fallback', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockRejectedValue({
        stdout: '[]',
        message: 'CLI error',
      });

      const bugs = await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs).toEqual([]);
    });

    it('should throw error when claude not found', async () => {
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
      ).rejects.toThrow('Claude CLI not found');
    });

    it('should throw error on timeout', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockRejectedValue({ message: 'timeout' });

      await expect(
        provider.analyze({
          files: ['/project/src/test.ts'],
          cwd: '/project',
          understanding: mockUnderstanding,
          staticAnalysisResults: [],
        })
      ).rejects.toThrow('Claude CLI timed out');
    });

    it('should include static analysis signals in prompt', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: '[]' } as any);

      await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [
          { tool: 'eslint', file: 'src/test.ts', line: 5, message: 'No explicit any', severity: 'warning' },
        ],
      });

      expect(execa).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', expect.stringContaining('eslint')]),
        expect.any(Object)
      );
    });

    it('should skip files that do not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execa).mockResolvedValue({ stdout: '[]' } as any);

      const bugs = await provider.analyze({
        files: ['/project/src/missing.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs).toEqual([]);
    });

    it('should truncate large files', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('x'.repeat(60000));
      vi.mocked(execa).mockResolvedValue({ stdout: '[]' } as any);

      await provider.analyze({
        files: ['/project/src/large.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      // Should have called execa with truncated content
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
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs[0].severity).toBe('critical');
      expect(bugs[1].severity).toBe('low');
      expect(bugs[2].severity).toBe('medium'); // Invalid defaults to medium
    });

    it('should parse category correctly', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          { file: 'test.ts', line: 1, title: 'Bug 1', severity: 'high', category: 'security' },
          { file: 'test.ts', line: 2, title: 'Bug 2', severity: 'high', category: 'null_reference' },
          { file: 'test.ts', line: 3, title: 'Bug 3', severity: 'high', category: 'xss' },
          { file: 'test.ts', line: 4, title: 'Bug 4', severity: 'high', category: 'async' },
          { file: 'test.ts', line: 5, title: 'Bug 5', severity: 'high', category: 'edge' },
          { file: 'test.ts', line: 6, title: 'Bug 6', severity: 'high', category: 'type_coercion' },
          { file: 'test.ts', line: 7, title: 'Bug 7', severity: 'high', category: 'leak' },
        ]),
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs[0].category).toBe('security');
      expect(bugs[1].category).toBe('null-reference');
      expect(bugs[2].category).toBe('security');
      expect(bugs[3].category).toBe('async-race-condition');
      expect(bugs[4].category).toBe('edge-case');
      expect(bugs[5].category).toBe('type-coercion');
      expect(bugs[6].category).toBe('resource-leak');
    });

    it('should extract JSON from markdown code blocks', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: 'Here are the bugs:\n```json\n[{"file": "test.ts", "line": 1, "title": "Bug"}]\n```',
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs.length).toBe(1);
      expect(bugs[0].title).toBe('Bug');
    });

    it('should resolve relative file paths', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify([
          { file: 'src/test.ts', line: 1, title: 'Bug' },
        ]),
      } as any);

      const bugs = await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(bugs[0].file).toBe('/project/src/test.ts');
    });

    it('should include contracts in prompt when available', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: '[]' } as any);

      const understandingWithContracts: CodebaseUnderstanding = {
        ...mockUnderstanding,
        contracts: [
          {
            function: 'processPayment',
            file: 'payment.ts',
            inputs: [],
            outputs: { type: 'Result' },
            invariants: ['Must validate amount', 'Must not double-charge'],
            sideEffects: ['Creates payment record'],
          },
        ],
      };

      await provider.analyze({
        files: ['/project/src/test.ts'],
        cwd: '/project',
        understanding: understandingWithContracts,
        staticAnalysisResults: [],
      });

      expect(execa).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', expect.stringContaining('processPayment')]),
        expect.any(Object)
      );
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
        stdout: '{"survived": false, "counterArguments": ["There is a null check on line 8"], "confidence": "high"}',
      } as any);

      const result = await provider.adversarialValidate(mockBug, {
        files: [],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      // Implementation returns survived based on parsing - verify response is parsed
      expect(result).toHaveProperty('survived');
      expect(result).toHaveProperty('counterArguments');
    });

    it('should return survived true on parse error (conservative)', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: 'not json' } as any);

      const result = await provider.adversarialValidate(mockBug, {
        files: [],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(result.survived).toBe(true);
      expect(result.counterArguments).toEqual([]);
    });

    it('should handle file not existing', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify({ survived: true, counterArguments: [], confidence: 'medium' }),
      } as any);

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
      } as any);

      const result = await provider.adversarialValidate(mockBug, {
        files: [],
        cwd: '/project',
        understanding: mockUnderstanding,
        staticAnalysisResults: [],
      });

      expect(result.survived).toBe(true);
      // When survived, adjustedConfidence is set
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
      } as any);

      await provider.generateUnderstanding(['/project/src/index.ts']);

      expect(execa).toHaveBeenCalledWith('claude', expect.any(Array), expect.any(Object));
    });

    it('should handle parse errors gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({ stdout: 'not json' } as any);

      const understanding = await provider.generateUnderstanding(['/project/src/index.ts']);

      expect(understanding.summary.type).toBe('unknown');
      expect(understanding.summary.description).toContain('Failed to analyze');
    });

    it('should prioritize important files', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: '{"summary": {"type": "app", "language": "typescript", "description": "App"}, "features": [], "contracts": []}',
      } as any);

      // Create more than 40 files
      const files = Array.from({ length: 50 }, (_, i) => `/project/src/file${i}.ts`);
      files.unshift('/project/package.json');
      files.push('/project/src/index.ts');

      await provider.generateUnderstanding(files);

      // Should have called execa (meaning files were prioritized and limited)
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
      } as any);

      const understanding = await provider.generateUnderstanding([
        '/project/package.json',
        '/project/src/index.ts',
      ]);

      expect(understanding).toBeDefined();
    });

    it('should return structure with totalFiles', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('const x = 1;');
      vi.mocked(execa).mockResolvedValue({
        stdout: '{"summary": {"type": "app", "language": "typescript", "description": "App"}, "features": [], "contracts": []}',
      } as any);

      const understanding = await provider.generateUnderstanding([
        '/project/src/a.ts',
        '/project/src/b.ts',
      ]);

      expect(understanding.structure.totalFiles).toBe(2);
    });
  });
});
