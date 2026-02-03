import { describe, it, expect } from 'vitest';
import { outputSarif } from '../../../src/output/sarif';
import { Bug, ScanResult } from '../../../src/types';

describe('output/sarif', () => {
  const mockBugs: Bug[] = [
    {
      id: 'WR-001',
      title: 'Null reference bug',
      description: 'Potential null dereference at line 5',
      file: 'src/test.ts',
      line: 5,
      endLine: 5,
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
          file: 'src/test.ts',
          line: 3,
          code: 'const user = find(id);',
          explanation: 'User may be null',
        },
        {
          step: 2,
          file: 'src/test.ts',
          line: 5,
          code: 'return user.name;',
          explanation: 'Dereference without check',
        },
      ],
      evidence: ['No null check before access'],
      suggestedFix: 'return user?.name;',
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'WR-002',
      title: 'Race condition',
      description: 'Potential race condition in async code',
      file: 'src/async.ts',
      line: 10,
      severity: 'critical',
      category: 'async-race-condition',
      confidence: {
        overall: 'medium',
        codePathValidity: 0.7,
        reachability: 0.8,
        intentViolation: true,
        staticToolSignal: false,
        adversarialSurvived: true,
      },
      codePath: [],
      evidence: ['Shared state accessed without synchronization'],
      createdAt: '2024-01-01T00:00:00Z',
    },
  ];

  const mockScanResult: ScanResult = {
    bugs: mockBugs,
    scannedFiles: 10,
    skippedFiles: 2,
    duration: 5000,
    timestamp: '2024-01-01T00:00:00Z',
  };

  describe('outputSarif', () => {
    it('should return valid SARIF format', () => {
      const sarif = outputSarif(mockScanResult);

      expect(sarif.$schema).toContain('sarif');
      expect(sarif.version).toBe('2.1.0');
      expect(sarif.runs).toHaveLength(1);
    });

    it('should include tool information', () => {
      const sarif = outputSarif(mockScanResult);

      expect(sarif.runs[0].tool.driver.name).toBe('whiterose');
      expect(sarif.runs[0].tool.driver.informationUri).toBeDefined();
    });

    it('should convert bugs to SARIF results', () => {
      const sarif = outputSarif(mockScanResult);

      expect(sarif.runs[0].results).toHaveLength(2);

      const result1 = sarif.runs[0].results[0];
      expect(result1.ruleId).toBe('WR-001');
      expect(result1.message.text).toContain('Null reference bug');
    });

    it('should map severity to SARIF level', () => {
      const sarif = outputSarif(mockScanResult);

      // high severity -> error
      expect(sarif.runs[0].results[0].level).toBe('error');
      // critical severity -> error
      expect(sarif.runs[0].results[1].level).toBe('error');
    });

    it('should include file locations', () => {
      const sarif = outputSarif(mockScanResult);

      const location = sarif.runs[0].results[0].locations[0];
      expect(location.physicalLocation.artifactLocation.uri).toBe('src/test.ts');
      expect(location.physicalLocation.region.startLine).toBe(5);
    });

    it('should include code flows for bugs with code paths', () => {
      const sarif = outputSarif(mockScanResult);

      const result1 = sarif.runs[0].results[0];
      expect(result1.codeFlows).toBeDefined();
      expect(result1.codeFlows![0].threadFlows[0].locations).toHaveLength(2);
    });

    it('should not include code flows for bugs without code paths', () => {
      const sarif = outputSarif(mockScanResult);

      const result2 = sarif.runs[0].results[1];
      expect(result2.codeFlows).toBeUndefined();
    });

    it('should create rules from bug categories', () => {
      const sarif = outputSarif(mockScanResult);

      const rules = sarif.runs[0].tool.driver.rules;
      expect(rules.some(r => r.id === 'null-reference')).toBe(true);
      expect(rules.some(r => r.id === 'async-race-condition')).toBe(true);
    });

    it('should handle empty bug list', () => {
      const sarif = outputSarif({ ...mockScanResult, bugs: [] });

      expect(sarif.runs[0].results).toHaveLength(0);
    });

    it('should map low severity to note level', () => {
      const lowBug: Bug = {
        ...mockBugs[0],
        severity: 'low',
      };
      const sarif = outputSarif({ ...mockScanResult, bugs: [lowBug] });

      expect(sarif.runs[0].results[0].level).toBe('note');
    });

    it('should map medium severity to warning level', () => {
      const mediumBug: Bug = {
        ...mockBugs[0],
        severity: 'medium',
      };
      const sarif = outputSarif({ ...mockScanResult, bugs: [mediumBug] });

      expect(sarif.runs[0].results[0].level).toBe('warning');
    });
  });
});
