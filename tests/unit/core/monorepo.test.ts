import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs and fast-glob
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

import { readFileSync, existsSync } from 'fs';
import fg from 'fast-glob';
import {
  detectMonorepo,
  getPackageFiles,
  getPackageForFile,
  groupFilesByPackage,
  getCrossPackageDependencies,
  Package,
} from '../../../src/core/monorepo';

describe('core/monorepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectMonorepo', () => {
    it('should detect npm workspaces', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        if (path.includes('yarn.lock')) return false;
        return false;
      });

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        workspaces: ['packages/*'],
      }));

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/package.json',
        '/project/packages/cli/package.json',
      ]);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe('npm-workspaces');
      expect(info.packages.length).toBe(2);
    });

    it('should detect yarn workspaces', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        if (path.includes('yarn.lock')) return true;
        return false;
      });

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        workspaces: ['packages/*'],
      }));

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/package.json',
      ]);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe('yarn-workspaces');
    });

    it('should detect pnpm workspaces', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        if (path.includes('pnpm-workspace.yaml')) return true;
        return false;
      });

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.includes('pnpm-workspace.yaml')) {
          return `packages:
  - 'packages/*'
  - 'apps/*'`;
        }
        return JSON.stringify({ name: 'root' });
      });

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/package.json',
      ]);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe('pnpm-workspaces');
    });

    it('should detect lerna', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        if (path.includes('lerna.json')) return true;
        return false;
      });

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.includes('lerna.json')) {
          return JSON.stringify({ packages: ['packages/*'] });
        }
        return JSON.stringify({ name: 'root' });
      });

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/package.json',
      ]);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe('lerna');
    });

    it('should detect nx', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        if (path.includes('nx.json')) return true;
        return false;
      });

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'root' }));

      vi.mocked(fg).mockResolvedValue([
        '/project/apps/web/package.json',
        '/project/libs/shared/package.json',
      ]);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe('nx');
    });

    it('should detect turborepo', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        if (path.includes('turbo.json')) return true;
        // Don't detect yarn.lock so it falls through to turborepo check
        return false;
      });

      // No workspaces in package.json, so it checks turbo.json
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: 'turborepo-root',
      }));

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/package.json',
      ]);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe('turborepo');
    });

    it('should handle workspaces as object with packages property', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        if (path.includes('yarn.lock')) return false;
        return false;
      });

      // Workspaces defined as object with packages property (yarn style)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: 'workspace-root',
        workspaces: {
          packages: ['packages/*', 'apps/*'],
        },
      }));

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/package.json',
      ]);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(true);
      expect(info.type).toBe('npm-workspaces');
      expect(info.packages.length).toBe(1);
    });

    it('should handle invalid package.json in packages', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        return false;
      });

      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.endsWith('/project/package.json')) {
          return JSON.stringify({ workspaces: ['packages/*'] });
        }
        // Invalid JSON for package in monorepo
        if (path.includes('packages/invalid')) {
          return 'not valid json';
        }
        return JSON.stringify({ name: '@test/valid' });
      });

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/invalid/package.json',
        '/project/packages/valid/package.json',
      ]);

      const info = await detectMonorepo('/project');

      // Should skip invalid package and continue with valid one
      expect(info.isMonorepo).toBe(true);
      expect(info.packages.length).toBe(1);
      expect(info.packages[0].name).toBe('@test/valid');
    });

    it('should return not a monorepo for single package', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.includes('package.json')) return true;
        return false;
      });

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        name: 'single-package',
      }));

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(false);
      expect(info.type).toBe('none');
      expect(info.packages).toEqual([]);
    });

    it('should handle missing package.json', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const info = await detectMonorepo('/project');

      expect(info.isMonorepo).toBe(false);
      expect(info.type).toBe('none');
    });
  });

  describe('getPackageFiles', () => {
    it('should return files for a package', async () => {
      const pkg: Package = {
        name: '@test/core',
        path: '/project/packages/core',
        relativePath: 'packages/core',
        packageJson: { name: '@test/core' },
      };

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/src/index.ts',
        '/project/packages/core/src/utils.ts',
      ]);

      const files = await getPackageFiles(pkg);

      expect(files).toContain('/project/packages/core/src/index.ts');
      expect(files).toContain('/project/packages/core/src/utils.ts');
    });

    it('should support custom patterns', async () => {
      const pkg: Package = {
        name: '@test/core',
        path: '/project/packages/core',
        relativePath: 'packages/core',
        packageJson: { name: '@test/core' },
      };

      vi.mocked(fg).mockResolvedValue([
        '/project/packages/core/src/test.spec.ts',
      ]);

      const files = await getPackageFiles(pkg, ['**/*.spec.ts']);

      expect(fg).toHaveBeenCalledWith(
        ['**/*.spec.ts'],
        expect.objectContaining({
          cwd: '/project/packages/core',
        })
      );
    });
  });

  describe('getPackageForFile', () => {
    const packages: Package[] = [
      {
        name: '@test/core',
        path: '/project/packages/core',
        relativePath: 'packages/core',
        packageJson: { name: '@test/core' },
      },
      {
        name: '@test/cli',
        path: '/project/packages/cli',
        relativePath: 'packages/cli',
        packageJson: { name: '@test/cli' },
      },
    ];

    it('should return the package containing the file', () => {
      const pkg = getPackageForFile('/project/packages/core/src/index.ts', packages);

      expect(pkg?.name).toBe('@test/core');
    });

    it('should return null for files not in any package', () => {
      const pkg = getPackageForFile('/project/other/file.ts', packages);

      expect(pkg).toBeNull();
    });
  });

  describe('groupFilesByPackage', () => {
    const packages: Package[] = [
      {
        name: '@test/core',
        path: '/project/packages/core',
        relativePath: 'packages/core',
        packageJson: { name: '@test/core' },
      },
      {
        name: '@test/cli',
        path: '/project/packages/cli',
        relativePath: 'packages/cli',
        packageJson: { name: '@test/cli' },
      },
    ];

    it('should group files by their package', () => {
      const files = [
        '/project/packages/core/src/a.ts',
        '/project/packages/core/src/b.ts',
        '/project/packages/cli/src/c.ts',
        '/project/other/d.ts',
      ];

      const grouped = groupFilesByPackage(files, packages);

      expect(grouped.get(packages[0])).toEqual([
        '/project/packages/core/src/a.ts',
        '/project/packages/core/src/b.ts',
      ]);
      expect(grouped.get(packages[1])).toEqual([
        '/project/packages/cli/src/c.ts',
      ]);
      expect(grouped.get(null)).toEqual([
        '/project/other/d.ts',
      ]);
    });
  });

  describe('getCrossPackageDependencies', () => {
    it('should return cross-package dependencies', async () => {
      const packages: Package[] = [
        {
          name: '@test/core',
          path: '/project/packages/core',
          relativePath: 'packages/core',
          packageJson: {
            name: '@test/core',
            dependencies: {},
          },
        },
        {
          name: '@test/cli',
          path: '/project/packages/cli',
          relativePath: 'packages/cli',
          packageJson: {
            name: '@test/cli',
            dependencies: {
              '@test/core': '^1.0.0',
            },
          },
        },
      ];

      const deps = await getCrossPackageDependencies(packages);

      expect(deps.get('@test/cli')).toContain('@test/core');
      expect(deps.has('@test/core')).toBe(false); // core has no cross-package deps
    });

    it('should include dev and peer dependencies', async () => {
      const packages: Package[] = [
        {
          name: '@test/core',
          path: '/project/packages/core',
          relativePath: 'packages/core',
          packageJson: { name: '@test/core' },
        },
        {
          name: '@test/cli',
          path: '/project/packages/cli',
          relativePath: 'packages/cli',
          packageJson: {
            name: '@test/cli',
            devDependencies: {
              '@test/core': '^1.0.0',
            },
          },
        },
        {
          name: '@test/types',
          path: '/project/packages/types',
          relativePath: 'packages/types',
          packageJson: {
            name: '@test/types',
            peerDependencies: {
              '@test/core': '^1.0.0',
            },
          },
        },
      ];

      const deps = await getCrossPackageDependencies(packages);

      expect(deps.get('@test/cli')).toContain('@test/core');
      expect(deps.get('@test/types')).toContain('@test/core');
    });
  });
});
