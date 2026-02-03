import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../../../src/core/dependencies', () => ({
  getDependentFiles: vi.fn(),
}));

import fg from 'fast-glob';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { scanCodebase, getDependentFiles, hashFile, getChangedFiles } from '../../../src/core/scanner';
import { getDependentFiles as mockGetDepGraphDependents } from '../../../src/core/dependencies';

describe('core/scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanCodebase', () => {
    it('should scan with default include patterns', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/index.ts', '/project/src/utils.ts']);

      const files = await scanCodebase('/project');

      expect(fg).toHaveBeenCalledWith(
        ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
        expect.objectContaining({
          cwd: '/project',
          absolute: true,
          onlyFiles: true,
        })
      );
      expect(files).toContain('/project/src/index.ts');
    });

    it('should scan with default exclude patterns', async () => {
      vi.mocked(fg).mockResolvedValue([]);

      await scanCodebase('/project');

      expect(fg).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          ignore: expect.arrayContaining([
            'node_modules/**',
            'dist/**',
            'build/**',
            '.next/**',
            'coverage/**',
            '**/*.test.*',
            '**/*.spec.*',
            '**/*.d.ts',
            '.whiterose/**',
          ]),
        })
      );
    });

    it('should use config include patterns', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/app.py']);

      const config = {
        version: '1' as const,
        provider: 'claude-code' as const,
        include: ['**/*.py'],
        exclude: ['__pycache__/**'],
      };

      await scanCodebase('/project', config);

      expect(fg).toHaveBeenCalledWith(
        ['**/*.py'],
        expect.objectContaining({
          ignore: ['__pycache__/**'],
        })
      );
    });

    it('should return sorted files', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/z.ts', '/project/a.ts', '/project/m.ts']);

      const files = await scanCodebase('/project');

      expect(files).toEqual(['/project/a.ts', '/project/m.ts', '/project/z.ts']);
    });

    it('should handle empty result', async () => {
      vi.mocked(fg).mockResolvedValue([]);

      const files = await scanCodebase('/project');

      expect(files).toEqual([]);
    });
  });


  describe('getDependentFiles', () => {
    it('should delegate to dependency graph module', async () => {
      vi.mocked(mockGetDepGraphDependents).mockResolvedValue([
        '/project/src/a.ts',
        '/project/src/b.ts',
      ]);

      const result = await getDependentFiles(['/project/src/c.ts'], '/project');

      expect(mockGetDepGraphDependents).toHaveBeenCalledWith(
        ['/project/src/c.ts'],
        '/project',
        undefined
      );
      expect(result).toContain('/project/src/a.ts');
      expect(result).toContain('/project/src/b.ts');
    });

    it('should pass allFiles when provided', async () => {
      vi.mocked(mockGetDepGraphDependents).mockResolvedValue([]);

      const allFiles = ['/project/src/a.ts', '/project/src/b.ts'];
      await getDependentFiles(['/project/src/a.ts'], '/project', allFiles);

      expect(mockGetDepGraphDependents).toHaveBeenCalledWith(
        ['/project/src/a.ts'],
        '/project',
        allFiles
      );
    });
  });

  describe('hashFile', () => {
    it('should hash file content using md5', () => {
      vi.mocked(readFileSync).mockReturnValue('file content');

      const hash = hashFile('/project/src/test.ts');

      expect(readFileSync).toHaveBeenCalledWith('/project/src/test.ts', 'utf-8');
      // Verify the hash is a valid md5 hex string (32 chars)
      expect(hash).toMatch(/^[a-f0-9]{32}$/);
      // Same content should produce same hash
      expect(hash).toBe(createHash('md5').update('file content').digest('hex'));
    });

    it('should produce different hashes for different content', () => {
      vi.mocked(readFileSync)
        .mockReturnValueOnce('content 1')
        .mockReturnValueOnce('content 2');

      const hash1 = hashFile('/project/src/a.ts');
      const hash2 = hashFile('/project/src/b.ts');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getChangedFiles', () => {
    const mockConfig = {
      version: '1' as const,
      provider: 'claude-code' as const,
    };

    // Pre-compute the hash for 'content' to use in tests
    const contentHash = createHash('md5').update('content').digest('hex');

    it('should return all files when no cache exists', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/a.ts', '/project/src/b.ts']);
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFileSync).mockReturnValue('content');

      const result = await getChangedFiles('/project', mockConfig);

      expect(result.files).toContain('/project/src/a.ts');
      expect(result.files).toContain('/project/src/b.ts');
      expect(result.hashes.length).toBe(2);
    });

    it('should return only changed files when cache exists', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/a.ts', '/project/src/b.ts']);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.includes('file-hashes.json')) {
          return JSON.stringify({
            version: '1',
            fileHashes: [
              { path: 'src/a.ts', hash: contentHash }, // Same hash - no change
              { path: 'src/b.ts', hash: 'differenthash' }, // Different hash - changed
            ],
          });
        }
        return 'content';
      });

      const result = await getChangedFiles('/project', mockConfig);

      // Only b.ts should be marked as changed
      expect(result.files).toContain('/project/src/b.ts');
      expect(result.files).not.toContain('/project/src/a.ts');
    });

    it('should write updated cache after scanning', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/a.ts']);
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFileSync).mockReturnValue('content');

      await getChangedFiles('/project', mockConfig);

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('file-hashes.json'),
        expect.any(String),
        'utf-8'
      );
    });

    it('should include lastModified in hashes', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/a.ts']);
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readFileSync).mockReturnValue('content');

      const result = await getChangedFiles('/project', mockConfig);

      expect(result.hashes[0]).toHaveProperty('lastModified');
      expect(result.hashes[0].lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should preserve lastFullScan from cache', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/a.ts']);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.includes('file-hashes.json')) {
          return JSON.stringify({
            version: '1',
            lastFullScan: '2024-01-01T00:00:00Z',
            fileHashes: [],
          });
        }
        return 'content';
      });

      await getChangedFiles('/project', mockConfig);

      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.lastFullScan).toBe('2024-01-01T00:00:00Z');
    });

    it('should detect new files not in cache', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/a.ts', '/project/src/new.ts']);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.includes('file-hashes.json')) {
          return JSON.stringify({
            version: '1',
            fileHashes: [
              { path: 'src/a.ts', hash: contentHash },
            ],
          });
        }
        return 'content';
      });

      const result = await getChangedFiles('/project', mockConfig);

      // new.ts should be marked as changed since it's not in cache
      expect(result.files).toContain('/project/src/new.ts');
      expect(result.files).not.toContain('/project/src/a.ts');
    });
  });
});
