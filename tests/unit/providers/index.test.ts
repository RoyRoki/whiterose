import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the detect module which is used internally by executors
vi.mock('../../../src/providers/detect', () => ({
  isProviderAvailable: vi.fn().mockResolvedValue(true),
  getProviderCommand: vi.fn().mockReturnValue('mock-command'),
}));

// Mock execa for all executors
vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: 'mock output', stderr: '' }),
}));

import { getExecutor, getAvailableExecutors } from '../../../src/providers';

describe('providers/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getExecutor', () => {
    it('should return claude-code executor', () => {
      const executor = getExecutor('claude-code');
      expect(executor).toBeDefined();
      expect(executor.name).toBe('claude-code');
    });

    it('should return aider executor', () => {
      const executor = getExecutor('aider');
      expect(executor).toBeDefined();
      expect(executor.name).toBe('aider');
    });

    it('should return codex executor', () => {
      const executor = getExecutor('codex');
      expect(executor).toBeDefined();
      expect(executor.name).toBe('codex');
    });

    it('should return ollama executor', () => {
      const executor = getExecutor('ollama');
      expect(executor).toBeDefined();
      expect(executor.name).toBe('ollama');
    });

    it('should return gemini executor', () => {
      const executor = getExecutor('gemini');
      expect(executor).toBeDefined();
      expect(executor.name).toBe('gemini');
    });

    it('should return opencode executor', () => {
      const executor = getExecutor('opencode');
      expect(executor).toBeDefined();
      expect(executor.name).toBe('opencode');
    });

    it('should throw error for unknown provider', () => {
      // @ts-expect-error Testing invalid provider type
      expect(() => getExecutor('unknown-provider')).toThrow('Unknown provider');
    });
  });

  describe('getAvailableExecutors', () => {
    it('should return an array of executors', async () => {
      const available = await getAvailableExecutors();
      expect(Array.isArray(available)).toBe(true);
      // Returns executors that report themselves as available
      // (empty array is valid if no executors are available on this system)
    });
  });
});
