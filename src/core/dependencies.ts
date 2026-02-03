import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve, extname } from 'path';
import fg from 'fast-glob';

interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  isTypeOnly: boolean;
}

interface DependencyGraph {
  files: Map<string, Set<string>>; // file -> files it imports
  dependents: Map<string, Set<string>>; // file -> files that import it
}

/**
 * Build a dependency graph for the given files
 */
export async function buildDependencyGraph(
  cwd: string,
  files: string[]
): Promise<DependencyGraph> {
  const graph: DependencyGraph = {
    files: new Map(),
    dependents: new Map(),
  };

  for (const file of files) {
    const imports = await getFileImports(file);
    const resolvedImports = new Set<string>();

    for (const imp of imports) {
      const resolved = resolveImport(file, imp.source, cwd);
      if (resolved && files.includes(resolved)) {
        resolvedImports.add(resolved);
      }
    }

    graph.files.set(file, resolvedImports);

    // Build reverse mapping (dependents)
    for (const imported of resolvedImports) {
      if (!graph.dependents.has(imported)) {
        graph.dependents.set(imported, new Set());
      }
      graph.dependents.get(imported)!.add(file);
    }
  }

  return graph;
}

/**
 * Get all files that depend on the given files (directly or transitively)
 */
export async function getDependentFiles(
  changedFiles: string[],
  cwd: string,
  allFiles?: string[]
): Promise<string[]> {
  // Get all project files if not provided
  if (!allFiles) {
    allFiles = await fg(['**/*.{ts,tsx,js,jsx}'], {
      cwd,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**'],
      absolute: true,
    });
  }

  // Build dependency graph
  const graph = await buildDependencyGraph(cwd, allFiles);

  // Find all dependents transitively
  const dependents = new Set<string>(changedFiles);
  const queue = [...changedFiles];

  while (queue.length > 0) {
    const file = queue.shift()!;
    const fileDependents = graph.dependents.get(file);

    if (fileDependents) {
      for (const dep of fileDependents) {
        if (!dependents.has(dep)) {
          dependents.add(dep);
          queue.push(dep);
        }
      }
    }
  }

  return Array.from(dependents);
}

/**
 * Parse imports from a TypeScript/JavaScript file
 */
async function getFileImports(filePath: string): Promise<ImportInfo[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const imports: ImportInfo[] = [];

  // Match ES6 imports
  // import { x, y } from 'module'
  // import x from 'module'
  // import * as x from 'module'
  // import 'module'
  // import type { x } from 'module'
  const importRegex =
    /import\s+(?:(type)\s+)?(?:(\*\s+as\s+\w+)|(\{[^}]+\})|(\w+)(?:\s*,\s*(\{[^}]+\}))?|)\s*(?:from\s+)?['"]([^'"]+)['"]/g;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const isTypeOnly = !!match[1];
    const isNamespace = !!match[2];
    const namedImports = match[3] || match[5] || '';
    const defaultImport = match[4] || '';
    const source = match[6];

    const specifiers: string[] = [];

    if (defaultImport) {
      specifiers.push(defaultImport);
    }

    if (namedImports) {
      const named = namedImports
        .replace(/[{}]/g, '')
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      specifiers.push(...named);
    }

    imports.push({
      source,
      specifiers,
      isDefault: !!defaultImport,
      isNamespace,
      isTypeOnly,
    });
  }

  // Also match require() calls
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      isDefault: false,
      isNamespace: false,
      isTypeOnly: false,
    });
  }

  // Match dynamic imports
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      isDefault: false,
      isNamespace: false,
      isTypeOnly: false,
    });
  }

  return imports;
}

/**
 * Resolve an import path to an absolute file path
 */
function resolveImport(
  fromFile: string,
  importPath: string,
  cwd: string
): string | null {
  // Skip node_modules imports
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  const fromDir = dirname(fromFile);
  let resolved: string;

  if (importPath.startsWith('/')) {
    resolved = join(cwd, importPath);
  } else {
    resolved = resolve(fromDir, importPath);
  }

  // Try to resolve with different extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

  // First check if the path exists as-is
  if (existsSync(resolved)) {
    const ext = extname(resolved);
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      return resolved;
    }
    // It's a directory, try index files
    for (const ext of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
      if (existsSync(resolved + ext)) {
        return resolved + ext;
      }
    }
  }

  // Try adding extensions
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (existsSync(withExt)) {
      return withExt;
    }
  }

  // Try removing .js extension and adding .ts (common in ESM)
  if (importPath.endsWith('.js')) {
    const tsPath = resolved.replace(/\.js$/, '.ts');
    if (existsSync(tsPath)) {
      return tsPath;
    }
    const tsxPath = resolved.replace(/\.js$/, '.tsx');
    if (existsSync(tsxPath)) {
      return tsxPath;
    }
  }

  return null;
}

/**
 * Get the imports that a file makes
 */
export async function getImportsOf(filePath: string): Promise<string[]> {
  const imports = await getFileImports(filePath);
  return imports.map((i) => i.source);
}

/**
 * Check if fileA depends on fileB (directly or transitively)
 */
export async function dependsOn(
  fileA: string,
  fileB: string,
  cwd: string,
  allFiles: string[]
): Promise<boolean> {
  const graph = await buildDependencyGraph(cwd, allFiles);

  const visited = new Set<string>();
  const queue = [fileA];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = graph.files.get(current);
    if (!deps) continue;

    if (deps.has(fileB)) {
      return true;
    }

    for (const dep of deps) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return false;
}

/**
 * Get circular dependencies
 */
export async function findCircularDependencies(
  cwd: string,
  allFiles: string[]
): Promise<string[][]> {
  const graph = await buildDependencyGraph(cwd, allFiles);
  const circles: string[][] = [];

  for (const file of allFiles) {
    const path = findCycle(file, graph, []);
    if (path && !circles.some((c) => arraysEqual(c, path))) {
      circles.push(path);
    }
  }

  return circles;
}

function findCycle(
  file: string,
  graph: DependencyGraph,
  path: string[]
): string[] | null {
  const index = path.indexOf(file);
  if (index !== -1) {
    return path.slice(index);
  }

  const deps = graph.files.get(file);
  if (!deps) return null;

  for (const dep of deps) {
    const cycle = findCycle(dep, graph, [...path, file]);
    if (cycle) return cycle;
  }

  return null;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}
