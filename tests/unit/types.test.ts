import { describe, it, expect } from 'vitest';
import { Bug, WhiteroseConfig, BugSeverity, BugCategory } from '../../src/types';

describe('types', () => {
  describe('Bug', () => {
    it('should validate a valid bug', () => {
      const bug = {
        id: 'WR-001',
        title: 'Null dereference',
        description: 'Potential null dereference at line 42',
        file: 'src/api/users.ts',
        line: 42,
        severity: 'high' as const,
        category: 'null-reference' as const,
        confidence: {
          overall: 'high' as const,
          codePathValidity: 0.9,
          reachability: 0.85,
          intentViolation: false,
          staticToolSignal: true,
          adversarialSurvived: true,
        },
        codePath: [
          {
            step: 1,
            file: 'src/api/users.ts',
            line: 40,
            code: 'const user = await db.find(id)',
            explanation: 'User can be null if not found',
          },
          {
            step: 2,
            file: 'src/api/users.ts',
            line: 42,
            code: 'return user.name',
            explanation: 'Dereference without null check',
          },
        ],
        evidence: ['No null check before access', 'db.find returns null when not found'],
        createdAt: new Date().toISOString(),
      };

      const result = Bug.safeParse(bug);
      expect(result.success).toBe(true);
    });

    it('should reject invalid severity', () => {
      const bug = {
        id: 'WR-001',
        title: 'Test',
        description: 'Test',
        file: 'test.ts',
        line: 1,
        severity: 'invalid',
        category: 'logic-error',
        confidence: {
          overall: 'high',
          codePathValidity: 0.9,
          reachability: 0.9,
          intentViolation: false,
          staticToolSignal: false,
          adversarialSurvived: false,
        },
        codePath: [],
        evidence: [],
        createdAt: new Date().toISOString(),
      };

      const result = Bug.safeParse(bug);
      expect(result.success).toBe(false);
    });
  });

  describe('WhiteroseConfig', () => {
    it('should apply defaults', () => {
      const config = {};
      const result = WhiteroseConfig.parse(config);

      expect(result.version).toBe('1');
      expect(result.provider).toBe('claude-code');
      expect(result.include).toContain('**/*.ts');
      expect(result.exclude).toContain('node_modules');
    });

    it('should accept custom config', () => {
      const config = {
        provider: 'aider',
        include: ['src/**/*.ts'],
        minConfidence: 'high',
      };

      const result = WhiteroseConfig.parse(config);

      expect(result.provider).toBe('aider');
      expect(result.include).toEqual(['src/**/*.ts']);
      expect(result.minConfidence).toBe('high');
    });
  });

  describe('BugSeverity', () => {
    it('should accept valid severities', () => {
      expect(BugSeverity.parse('critical')).toBe('critical');
      expect(BugSeverity.parse('high')).toBe('high');
      expect(BugSeverity.parse('medium')).toBe('medium');
      expect(BugSeverity.parse('low')).toBe('low');
    });
  });

  describe('BugCategory', () => {
    it('should accept valid categories', () => {
      // Security categories
      expect(BugCategory.parse('injection')).toBe('injection');
      expect(BugCategory.parse('auth-bypass')).toBe('auth-bypass');
      expect(BugCategory.parse('secrets-exposure')).toBe('secrets-exposure');
      // Reliability categories
      expect(BugCategory.parse('null-reference')).toBe('null-reference');
      expect(BugCategory.parse('async-issue')).toBe('async-issue');
      // Correctness categories
      expect(BugCategory.parse('logic-error')).toBe('logic-error');
    });
  });
});
