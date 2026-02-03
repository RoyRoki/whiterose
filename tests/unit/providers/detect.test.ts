import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { detectProvider, isProviderAvailable } from '../../../src/providers/detect';

describe('providers/detect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectProvider', () => {
    it('should return empty array when no providers available', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('not found'));

      const providers = await detectProvider();

      expect(providers).toEqual([]);
    });

    it('should return claude-code when claude CLI is available', async () => {
      vi.mocked(execa).mockImplementation(async (cmd: string) => {
        if (cmd === 'claude') {
          return { stdout: '1.0.0' } as any;
        }
        throw new Error('not found');
      });

      const providers = await detectProvider();

      expect(providers).toContain('claude-code');
    });

    it('should return aider when aider CLI is available', async () => {
      vi.mocked(execa).mockImplementation(async (cmd: string) => {
        if (cmd === 'aider') {
          return { stdout: '0.50.0' } as any;
        }
        throw new Error('not found');
      });

      const providers = await detectProvider();

      expect(providers).toContain('aider');
    });

    it('should return codex when codex CLI is available', async () => {
      vi.mocked(execa).mockImplementation(async (cmd: string) => {
        if (cmd === 'codex') {
          return { stdout: '1.0.0' } as any;
        }
        throw new Error('not found');
      });

      const providers = await detectProvider();

      expect(providers).toContain('codex');
    });

    it('should return opencode when opencode CLI is available', async () => {
      vi.mocked(execa).mockImplementation(async (cmd: string) => {
        if (cmd === 'opencode') {
          return { stdout: '1.0.0' } as any;
        }
        throw new Error('not found');
      });

      const providers = await detectProvider();

      expect(providers).toContain('opencode');
    });

    it('should return multiple providers when available', async () => {
      vi.mocked(execa).mockImplementation(async (cmd: string) => {
        if (cmd === 'claude' || cmd === 'aider') {
          return { stdout: '1.0.0' } as any;
        }
        throw new Error('not found');
      });

      const providers = await detectProvider();

      expect(providers).toContain('claude-code');
      expect(providers).toContain('aider');
      expect(providers.length).toBe(2);
    });

    it('should call execa with correct timeout', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('not found'));

      await detectProvider();

      expect(execa).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--version']),
        expect.objectContaining({ timeout: 5000 })
      );
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true when claude-code is available', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '1.0.0' } as any);

      const result = await isProviderAvailable('claude-code');

      expect(result).toBe(true);
      expect(execa).toHaveBeenCalledWith('claude', ['--version'], expect.any(Object));
    });

    it('should return true when aider is available', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '0.50.0' } as any);

      const result = await isProviderAvailable('aider');

      expect(result).toBe(true);
      expect(execa).toHaveBeenCalledWith('aider', ['--version'], expect.any(Object));
    });

    it('should return false when provider is not found', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('ENOENT'));

      const result = await isProviderAvailable('claude-code');

      expect(result).toBe(false);
    });

    it('should return false when command times out', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('timeout'));

      const result = await isProviderAvailable('aider');

      expect(result).toBe(false);
    });

    it('should return false for unknown provider', async () => {
      // @ts-expect-error Testing unknown provider
      const result = await isProviderAvailable('unknown');

      expect(result).toBe(false);
    });

    it('should return true for ollama when available', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: 'ollama version 0.1.0' } as any);

      const result = await isProviderAvailable('ollama');

      expect(result).toBe(true);
    });

    it('should return true for gemini when available', async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: '1.0.0' } as any);

      const result = await isProviderAvailable('gemini');

      expect(result).toBe(true);
    });
  });
});
