import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { loadConfig, loadUnderstanding, saveConfig } from '../../../src/core/config';

describe('core/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    it('should throw error when config file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await expect(loadConfig('/test/project')).rejects.toThrow('Config file not found');
    });

    it('should load and parse YAML config', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
version: "1"
provider: aider
include:
  - "src/**/*.ts"
exclude:
  - node_modules
`);

      const config = await loadConfig('/test/project');

      expect(config.provider).toBe('aider');
      expect(config.include).toContain('src/**/*.ts');
    });

    it('should apply default values', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
version: "1"
provider: claude-code
`);

      const config = await loadConfig('/test/project');

      expect(config.version).toBe('1');
      expect(config.provider).toBe('claude-code');
      // Default includes should be applied
      expect(config.include).toBeDefined();
    });
  });

  describe('loadUnderstanding', () => {
    it('should return null when understanding file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const understanding = await loadUnderstanding('/test/project');

      expect(understanding).toBeNull();
    });

    it('should load understanding from JSON file', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        version: '1',
        generatedAt: '2024-01-01T00:00:00Z',
        summary: {
          type: 'web-app',
          description: 'Test app',
          language: 'typescript',
        },
        structure: {
          totalFiles: 10,
          totalLines: 1000,
        },
        features: [],
        contracts: [],
        dependencies: {},
      }));

      const understanding = await loadUnderstanding('/test/project');

      expect(understanding).not.toBeNull();
      expect(understanding?.summary.type).toBe('web-app');
    });
  });

  describe('saveConfig', () => {
    it('should write config as YAML', async () => {
      vi.mocked(writeFileSync).mockReturnValue(undefined);

      const config = {
        version: '1' as const,
        provider: 'claude-code' as const,
        include: ['**/*.ts'],
        exclude: ['node_modules'],
      };

      await saveConfig('/test/project', config);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('config.yml'),
        expect.any(String),
        'utf-8'
      );
    });
  });
});
