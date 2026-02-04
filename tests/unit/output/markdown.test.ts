import { describe, it, expect } from 'vitest';
import { outputMarkdown } from '../../../src/output/markdown';
import { Bug, ScanResult } from '../../../src/types';

describe('output/markdown', () => {
  const mockBugs: Bug[] = [
    {
      id: 'WR-001',
      title: 'Null reference bug',
      description: 'Potential null dereference when accessing user.name.',
      file: 'src/users/profile.ts',
      line: 42,
      endLine: 42,
      kind: 'bug',
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
          file: 'src/users/profile.ts',
          line: 40,
          code: 'const user = await db.findUser(id);',
          explanation: 'User may be null if not found in database',
        },
        {
          step: 2,
          file: 'src/users/profile.ts',
          line: 42,
          code: 'return user.name;',
          explanation: 'Dereference without null check',
        },
      ],
      evidence: [
        'No null check before access',
        'db.findUser returns null when user not found',
      ],
      suggestedFix: 'return user?.name ?? "Unknown";',
      createdAt: '2024-01-01T00:00:00Z',
      status: 'open',
    },
    {
      id: 'WR-002',
      title: 'Race condition in counter',
      description: 'Counter increment is not atomic.',
      file: 'src/stats/counter.ts',
      line: 15,
      kind: 'bug',
      severity: 'critical',
      category: 'async-issue',
      confidence: {
        overall: 'medium',
        codePathValidity: 0.7,
        reachability: 0.8,
        intentViolation: true,
        staticToolSignal: false,
        adversarialSurvived: true,
      },
      codePath: [],
      evidence: ['Non-atomic read-modify-write pattern'],
      createdAt: '2024-01-01T00:00:00Z',
      status: 'open',
    },
  ];

  const mockScanResult: ScanResult = {
    id: 'scan-test',
    timestamp: '2024-01-01T00:00:00Z',
    bugs: mockBugs,
    summary: {
      total: 2,
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
      bugs: 2,
      smells: 0,
    },
    scanType: 'full',
    filesScanned: 50,
    duration: 100,
  };

  describe('outputMarkdown', () => {
    it('should include header', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('# Bug Report');
      expect(md).toContain('whiterose');
    });

    it('should include summary table', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('## Summary');
      expect(md).toContain('| Severity | Count |');
      expect(md).toContain('Critical');
      expect(md).toContain('High');
    });

    it('should include scan info', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('Files Scanned');
      expect(md).toContain('50');
    });

    it('should group bugs by severity', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('### Critical');
      expect(md).toContain('### High');
    });

    it('should include bug details', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('WR-001');
      expect(md).toContain('Null reference bug');
      expect(md).toContain('src/users/profile.ts');
      expect(md).toContain('42');
    });

    it('should include code path', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('Code Path');
      expect(md).toContain('findUser');
    });

    it('should include evidence', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('Evidence');
      expect(md).toContain('No null check before access');
    });

    it('should include suggested fix when available', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('Suggested Fix');
      expect(md).toContain('user?.name');
    });

    it('should include confidence badge', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('HIGH CONFIDENCE');
    });

    it('should handle empty bug list', () => {
      const emptyResult: ScanResult = {
        ...mockScanResult,
        bugs: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, bugs: 0, smells: 0 },
      };

      const md = outputMarkdown(emptyResult);

      expect(md).toContain('No findings found');
    });

    it('should include category in bug details', () => {
      const md = outputMarkdown(mockScanResult);

      expect(md).toContain('Null Reference');
    });

    it('should show low confidence badge', () => {
      const lowConfidenceResult: ScanResult = {
        ...mockScanResult,
        bugs: [
          {
            ...mockBugs[0],
            confidence: {
              ...mockBugs[0].confidence,
              overall: 'low',
            },
          },
        ],
      };

      const md = outputMarkdown(lowConfidenceResult);

      expect(md).toContain('LOW CONFIDENCE');
    });

    it('should handle unknown confidence gracefully', () => {
      const unknownConfidenceResult: ScanResult = {
        ...mockScanResult,
        bugs: [
          {
            ...mockBugs[0],
            confidence: {
              ...mockBugs[0].confidence,
              overall: 'unknown' as any,
            },
          },
        ],
      };

      const md = outputMarkdown(unknownConfidenceResult);

      // Should not crash and should still produce output
      expect(md).toContain('Bug Report');
    });

    it('should detect Python file language', () => {
      const pythonResult: ScanResult = {
        ...mockScanResult,
        bugs: [
          {
            ...mockBugs[0],
            file: 'src/main.py',
            codePath: [
              {
                step: 1,
                file: 'src/main.py',
                line: 10,
                code: 'x = None',
                explanation: 'Variable is None',
              },
            ],
          },
        ],
      };

      const md = outputMarkdown(pythonResult);

      expect(md).toContain('```python');
    });

    it('should detect Go file language', () => {
      const goResult: ScanResult = {
        ...mockScanResult,
        bugs: [
          {
            ...mockBugs[0],
            file: 'main.go',
            codePath: [
              {
                step: 1,
                file: 'main.go',
                line: 10,
                code: 'var x *int = nil',
                explanation: 'Nil pointer',
              },
            ],
          },
        ],
      };

      const md = outputMarkdown(goResult);

      expect(md).toContain('```go');
    });

    it('should handle unknown file extension', () => {
      const unknownResult: ScanResult = {
        ...mockScanResult,
        bugs: [
          {
            ...mockBugs[0],
            file: 'src/config.yaml',
            codePath: [
              {
                step: 1,
                file: 'src/config.yaml',
                line: 5,
                code: 'key: value',
                explanation: 'Config issue',
              },
            ],
          },
        ],
      };

      const md = outputMarkdown(unknownResult);

      // Should produce output without crashing
      expect(md).toContain('config.yaml');
    });
  });
});
