import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/providers/adapters/claude-code', () => ({
  ClaudeCodeProvider: vi.fn().mockImplementation(() => ({
    name: 'claude-code',
    isAvailable: vi.fn(),
  })),
}));

vi.mock('../../../src/providers/adapters/aider', () => ({
  AiderProvider: vi.fn().mockImplementation(() => ({
    name: 'aider',
    isAvailable: vi.fn(),
  })),
}));

import { getProvider, ClaudeCodeProvider, AiderProvider } from '../../../src/providers';

describe('providers/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getProvider', () => {
    it('should return claude-code provider when available', async () => {
      vi.mocked(ClaudeCodeProvider).mockImplementation(() => ({
        name: 'claude-code',
        isAvailable: vi.fn().mockResolvedValue(true),
        detect: vi.fn(),
        analyze: vi.fn(),
        adversarialValidate: vi.fn(),
        generateUnderstanding: vi.fn(),
      }));

      const provider = await getProvider('claude-code');

      expect(provider.name).toBe('claude-code');
    });

    it('should return aider provider when available', async () => {
      vi.mocked(AiderProvider).mockImplementation(() => ({
        name: 'aider',
        isAvailable: vi.fn().mockResolvedValue(true),
        detect: vi.fn(),
        analyze: vi.fn(),
        adversarialValidate: vi.fn(),
        generateUnderstanding: vi.fn(),
      }));

      const provider = await getProvider('aider');

      expect(provider.name).toBe('aider');
    });

    it('should throw error when provider is not available', async () => {
      vi.mocked(ClaudeCodeProvider).mockImplementation(() => ({
        name: 'claude-code',
        isAvailable: vi.fn().mockResolvedValue(false),
        detect: vi.fn(),
        analyze: vi.fn(),
        adversarialValidate: vi.fn(),
        generateUnderstanding: vi.fn(),
      }));

      await expect(getProvider('claude-code')).rejects.toThrow(
        'Provider claude-code is not available'
      );
    });

    it('should throw error for codex provider (not implemented)', async () => {
      await expect(getProvider('codex')).rejects.toThrow('Codex provider not yet implemented');
    });

    it('should throw error for opencode provider (not implemented)', async () => {
      await expect(getProvider('opencode')).rejects.toThrow('OpenCode provider not yet implemented');
    });

    it('should throw error for ollama provider (not implemented)', async () => {
      await expect(getProvider('ollama')).rejects.toThrow('Ollama provider not yet implemented');
    });

    it('should throw error for unknown provider', async () => {
      // @ts-expect-error Testing invalid provider type
      await expect(getProvider('unknown-provider')).rejects.toThrow('Unknown provider');
    });
  });

  describe('exports', () => {
    it('should export ClaudeCodeProvider', () => {
      expect(ClaudeCodeProvider).toBeDefined();
    });

    it('should export AiderProvider', () => {
      expect(AiderProvider).toBeDefined();
    });
  });
});
