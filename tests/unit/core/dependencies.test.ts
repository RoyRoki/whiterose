import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import fg from 'fast-glob';
import {
  buildDependencyGraph,
  getDependentFiles,
  getImportsOf,
  dependsOn,
  findCircularDependencies,
} from '../../../src/core/dependencies';

describe('core/dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildDependencyGraph', () => {
    it('should build graph for files with imports', async () => {
      // Only return true for actual file paths with extensions
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.ts') || path.endsWith('.js');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { b } from './b';";
        if (path === '/project/src/b.ts') return "import { c } from './c';";
        if (path === '/project/src/c.ts') return '';
        return '';
      });

      const graph = await buildDependencyGraph('/project', [
        '/project/src/a.ts',
        '/project/src/b.ts',
        '/project/src/c.ts',
      ]);

      expect(graph.files.size).toBe(3);
      expect(graph.files.get('/project/src/a.ts')?.has('/project/src/b.ts')).toBe(true);
      expect(graph.files.get('/project/src/b.ts')?.has('/project/src/c.ts')).toBe(true);
    });

    it('should build dependents map', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { b } from './b';";
        if (path === '/project/src/b.ts') return '';
        return '';
      });

      const graph = await buildDependencyGraph('/project', [
        '/project/src/a.ts',
        '/project/src/b.ts',
      ]);

      expect(graph.dependents.get('/project/src/b.ts')?.has('/project/src/a.ts')).toBe(true);
    });

    it('should handle empty file list', async () => {
      const graph = await buildDependencyGraph('/project', []);

      expect(graph.files.size).toBe(0);
      expect(graph.dependents.size).toBe(0);
    });

    it('should resolve index files in directories', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        // Simulate a directory with index.ts
        if (path === '/project/src/utils') return true; // directory exists
        if (path === '/project/src/utils/index.ts') return true;
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { util } from './utils';";
        if (path === '/project/src/utils/index.ts') return 'export const util = 1;';
        return '';
      });

      const graph = await buildDependencyGraph('/project', [
        '/project/src/a.ts',
        '/project/src/utils/index.ts',
      ]);

      expect(graph.files.size).toBe(2);
    });

    it('should handle .js imports that resolve to .ts files', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        // .js file doesn't exist, but .ts does
        if (path.endsWith('.js')) return false;
        if (path === '/project/src/module.ts') return true;
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { x } from './module.js';";
        if (path === '/project/src/module.ts') return 'export const x = 1;';
        return '';
      });

      const graph = await buildDependencyGraph('/project', [
        '/project/src/a.ts',
        '/project/src/module.ts',
      ]);

      // The .js import should resolve to .ts
      expect(graph.files.size).toBe(2);
    });

    it('should skip node_modules imports', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => path.endsWith('.ts'));
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import lodash from 'lodash';";
        return '';
      });

      const graph = await buildDependencyGraph('/project', ['/project/src/a.ts']);

      // Node module imports should not create edges
      expect(graph.files.get('/project/src/a.ts')?.size).toBe(0);
    });

    it('should handle absolute path imports', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => path.endsWith('.ts'));
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { x } from '/utils/helper';";
        if (path === '/project/utils/helper.ts') return 'export const x = 1;';
        return '';
      });

      const graph = await buildDependencyGraph('/project', [
        '/project/src/a.ts',
        '/project/utils/helper.ts',
      ]);

      expect(graph.files.size).toBe(2);
    });
  });

  describe('getDependentFiles', () => {
    it('should return transitive dependents', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { b } from './b';";
        if (path === '/project/src/b.ts') return "import { c } from './c';";
        if (path === '/project/src/c.ts') return '';
        return '';
      });

      const allFiles = [
        '/project/src/a.ts',
        '/project/src/b.ts',
        '/project/src/c.ts',
      ];

      const dependents = await getDependentFiles(
        ['/project/src/c.ts'],
        '/project',
        allFiles
      );

      // c is imported by b, b is imported by a
      expect(dependents).toContain('/project/src/c.ts');
      expect(dependents).toContain('/project/src/b.ts');
      expect(dependents).toContain('/project/src/a.ts');
    });

    it('should fetch files if not provided', async () => {
      vi.mocked(fg).mockResolvedValue(['/project/src/a.ts']);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');

      await getDependentFiles(['/project/src/a.ts'], '/project');

      expect(fg).toHaveBeenCalled();
    });
  });

  describe('getImportsOf', () => {
    it('should return import sources', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
import { a } from './a';
import b from './b';
const c = require('./c');
`);

      const imports = await getImportsOf('/project/src/test.ts');

      expect(imports).toContain('./a');
      expect(imports).toContain('./b');
      expect(imports).toContain('./c');
    });

    it('should return empty array for non-existent file', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const imports = await getImportsOf('/project/src/missing.ts');

      expect(imports).toEqual([]);
    });

    it('should parse namespace imports', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
import * as utils from './utils';
`);

      const imports = await getImportsOf('/project/src/test.ts');

      expect(imports).toContain('./utils');
    });

    it('should parse type imports', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
import type { User } from './types';
`);

      const imports = await getImportsOf('/project/src/test.ts');

      expect(imports).toContain('./types');
    });

    it('should parse dynamic imports', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
const module = await import('./dynamic');
`);

      const imports = await getImportsOf('/project/src/test.ts');

      expect(imports).toContain('./dynamic');
    });

    it('should parse combined default and named imports', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
import React, { useState, useEffect } from 'react';
`);

      const imports = await getImportsOf('/project/src/test.ts');

      expect(imports).toContain('react');
    });

    it('should parse side-effect imports', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
import './side-effect';
`);

      const imports = await getImportsOf('/project/src/test.ts');

      expect(imports).toContain('./side-effect');
    });
  });

  describe('dependsOn', () => {
    it('should return true for direct dependency', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { b } from './b';";
        if (path === '/project/src/b.ts') return '';
        return '';
      });

      const result = await dependsOn(
        '/project/src/a.ts',
        '/project/src/b.ts',
        '/project',
        ['/project/src/a.ts', '/project/src/b.ts']
      );

      expect(result).toBe(true);
    });

    it('should return true for transitive dependency', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { b } from './b';";
        if (path === '/project/src/b.ts') return "import { c } from './c';";
        if (path === '/project/src/c.ts') return '';
        return '';
      });

      const result = await dependsOn(
        '/project/src/a.ts',
        '/project/src/c.ts',
        '/project',
        ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts']
      );

      expect(result).toBe(true);
    });

    it('should return false when no dependency', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');

      const result = await dependsOn(
        '/project/src/a.ts',
        '/project/src/b.ts',
        '/project',
        ['/project/src/a.ts', '/project/src/b.ts']
      );

      expect(result).toBe(false);
    });
  });

  describe('findCircularDependencies', () => {
    it('should detect circular dependencies', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { b } from './b';";
        if (path === '/project/src/b.ts') return "import { a } from './a';";
        return '';
      });

      const circles = await findCircularDependencies('/project', [
        '/project/src/a.ts',
        '/project/src/b.ts',
      ]);

      expect(circles.length).toBeGreaterThan(0);
    });

    it('should return empty array when no circular dependencies', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.ts');
      });
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path === '/project/src/a.ts') return "import { b } from './b';";
        if (path === '/project/src/b.ts') return '';
        return '';
      });

      const circles = await findCircularDependencies('/project', [
        '/project/src/a.ts',
        '/project/src/b.ts',
      ]);

      expect(circles).toEqual([]);
    });
  });
});
