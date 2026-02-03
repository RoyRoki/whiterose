import { describe, it, expect } from 'vitest';
import {
  generateBugId,
  parseBugId,
  formatDuration,
  truncate,
  pluralize,
} from '../../../src/core/utils';

describe('core/utils', () => {
  describe('generateBugId', () => {
    it('should generate WR-001 for index 0', () => {
      expect(generateBugId(0)).toBe('WR-001');
    });

    it('should generate WR-010 for index 9', () => {
      expect(generateBugId(9)).toBe('WR-010');
    });

    it('should generate WR-100 for index 99', () => {
      expect(generateBugId(99)).toBe('WR-100');
    });

    it('should pad numbers correctly', () => {
      expect(generateBugId(0)).toBe('WR-001');
      expect(generateBugId(1)).toBe('WR-002');
      expect(generateBugId(98)).toBe('WR-099');
    });
  });

  describe('parseBugId', () => {
    it('should parse WR-001 to index 0', () => {
      expect(parseBugId('WR-001')).toBe(0);
    });

    it('should parse WR-010 to index 9', () => {
      expect(parseBugId('WR-010')).toBe(9);
    });

    it('should parse WR-100 to index 99', () => {
      expect(parseBugId('WR-100')).toBe(99);
    });

    it('should return null for invalid format', () => {
      expect(parseBugId('invalid')).toBeNull();
      expect(parseBugId('WR-')).toBeNull();
      expect(parseBugId('WR-abc')).toBeNull();
      expect(parseBugId('001')).toBeNull();
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(1500)).toBe('1.5s');
      expect(formatDuration(59999)).toBe('60.0s');
    });

    it('should format minutes', () => {
      expect(formatDuration(60000)).toBe('1.0m');
      expect(formatDuration(90000)).toBe('1.5m');
      expect(formatDuration(120000)).toBe('2.0m');
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      expect(truncate('hello', 10)).toBe('hello');
      expect(truncate('hello', 5)).toBe('hello');
    });

    it('should truncate long strings with ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
      expect(truncate('this is a long string', 10)).toBe('this is...');
    });

    it('should handle edge cases', () => {
      expect(truncate('', 5)).toBe('');
      expect(truncate('abc', 3)).toBe('abc');
    });
  });

  describe('pluralize', () => {
    it('should return singular for count 1', () => {
      expect(pluralize(1, 'bug')).toBe('bug');
      expect(pluralize(1, 'file')).toBe('file');
    });

    it('should return plural for count != 1', () => {
      expect(pluralize(0, 'bug')).toBe('bugs');
      expect(pluralize(2, 'bug')).toBe('bugs');
      expect(pluralize(100, 'file')).toBe('files');
    });

    it('should use custom plural when provided', () => {
      expect(pluralize(2, 'index', 'indices')).toBe('indices');
      expect(pluralize(0, 'child', 'children')).toBe('children');
    });

    it('should return singular for 1 even with custom plural', () => {
      expect(pluralize(1, 'index', 'indices')).toBe('index');
    });
  });
});
