import { existsSync, readFileSync } from 'fs';
import { join, relative, dirname } from 'path';
import fg from 'fast-glob';

export interface Package {
  name: string;
  path: string;
  relativePath: string;
  packageJson: Record<string, any>;
}

export interface MonorepoInfo {
  isMonorepo: boolean;
  type: 'npm-workspaces' | 'yarn-workspaces' | 'pnpm-workspaces' | 'lerna' | 'nx' | 'turborepo' | 'none';
  rootPath: string;
  packages: Package[];
}

/**
 * Detect if the cwd is a monorepo and return info about packages
 */
export async function detectMonorepo(cwd: string): Promise<MonorepoInfo> {
  // Check for various monorepo configurations
  const packageJsonPath = join(cwd, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return {
      isMonorepo: false,
      type: 'none',
      rootPath: cwd,
      packages: [],
    };
  }

  let packageJson: Record<string, any>;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return {
      isMonorepo: false,
      type: 'none',
      rootPath: cwd,
      packages: [],
    };
  }

  // Check for npm/yarn workspaces
  if (packageJson.workspaces) {
    const workspacePatterns = Array.isArray(packageJson.workspaces)
      ? packageJson.workspaces
      : packageJson.workspaces.packages || [];

    const packages = await findPackages(cwd, workspacePatterns);

    const type = existsSync(join(cwd, 'yarn.lock')) ? 'yarn-workspaces' : 'npm-workspaces';

    return {
      isMonorepo: packages.length > 0,
      type,
      rootPath: cwd,
      packages,
    };
  }

  // Check for pnpm workspaces
  const pnpmWorkspacePath = join(cwd, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWorkspacePath)) {
    const pnpmWorkspace = readFileSync(pnpmWorkspacePath, 'utf-8');
    const packagesMatch = pnpmWorkspace.match(/packages:\s*([\s\S]*?)(?=\n\w|$)/);

    if (packagesMatch) {
      const patterns = packagesMatch[1]
        .split('\n')
        .map((line) => line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
        .filter((line) => line && !line.startsWith('#'));

      const packages = await findPackages(cwd, patterns);

      return {
        isMonorepo: packages.length > 0,
        type: 'pnpm-workspaces',
        rootPath: cwd,
        packages,
      };
    }
  }

  // Check for lerna
  const lernaJsonPath = join(cwd, 'lerna.json');
  if (existsSync(lernaJsonPath)) {
    try {
      const lernaConfig = JSON.parse(readFileSync(lernaJsonPath, 'utf-8'));
      const patterns = lernaConfig.packages || ['packages/*'];
      const packages = await findPackages(cwd, patterns);

      return {
        isMonorepo: packages.length > 0,
        type: 'lerna',
        rootPath: cwd,
        packages,
      };
    } catch {
      // Invalid lerna.json
    }
  }

  // Check for Nx
  const nxJsonPath = join(cwd, 'nx.json');
  if (existsSync(nxJsonPath)) {
    // Nx can have apps/ and libs/ directories
    const nxPatterns = ['apps/*', 'libs/*', 'packages/*'];
    const packages = await findPackages(cwd, nxPatterns);

    return {
      isMonorepo: packages.length > 0,
      type: 'nx',
      rootPath: cwd,
      packages,
    };
  }

  // Check for Turborepo
  const turboJsonPath = join(cwd, 'turbo.json');
  if (existsSync(turboJsonPath)) {
    // Turborepo typically uses npm/yarn/pnpm workspaces
    // but we detect turbo.json as an indicator
    const workspacePatterns = packageJson.workspaces
      ? Array.isArray(packageJson.workspaces)
        ? packageJson.workspaces
        : packageJson.workspaces.packages || []
      : ['packages/*', 'apps/*'];

    const packages = await findPackages(cwd, workspacePatterns);

    return {
      isMonorepo: packages.length > 0,
      type: 'turborepo',
      rootPath: cwd,
      packages,
    };
  }

  // Not a monorepo
  return {
    isMonorepo: false,
    type: 'none',
    rootPath: cwd,
    packages: [],
  };
}

/**
 * Find all packages matching the given workspace patterns
 */
async function findPackages(cwd: string, patterns: string[]): Promise<Package[]> {
  const packages: Package[] = [];

  // Convert workspace patterns to glob patterns for package.json files
  const globPatterns = patterns.map((pattern) => {
    // Remove trailing slash if present
    pattern = pattern.replace(/\/$/, '');
    // If pattern ends with *, look for package.json in subdirectories
    if (pattern.endsWith('*')) {
      return `${pattern}/package.json`;
    }
    // If pattern is a specific directory, look for package.json there
    return `${pattern}/package.json`;
  });

  const packageJsonPaths = await fg(globPatterns, {
    cwd,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });

  for (const pkgJsonPath of packageJsonPaths) {
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const pkgDir = dirname(pkgJsonPath);

      packages.push({
        name: pkgJson.name || relative(cwd, pkgDir),
        path: pkgDir,
        relativePath: relative(cwd, pkgDir),
        packageJson: pkgJson,
      });
    } catch {
      // Invalid package.json, skip
    }
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get files belonging to a specific package
 */
export async function getPackageFiles(
  pkg: Package,
  patterns: string[] = ['**/*.{ts,tsx,js,jsx}'],
  ignore: string[] = ['node_modules/**', 'dist/**', 'build/**']
): Promise<string[]> {
  return fg(patterns, {
    cwd: pkg.path,
    absolute: true,
    ignore,
    onlyFiles: true,
  });
}

/**
 * Detect which package a file belongs to
 */
export function getPackageForFile(file: string, packages: Package[]): Package | null {
  for (const pkg of packages) {
    if (file.startsWith(pkg.path)) {
      return pkg;
    }
  }
  return null;
}

/**
 * Group files by package
 */
export function groupFilesByPackage(
  files: string[],
  packages: Package[]
): Map<Package | null, string[]> {
  const grouped = new Map<Package | null, string[]>();

  for (const file of files) {
    const pkg = getPackageForFile(file, packages);
    const existing = grouped.get(pkg) || [];
    existing.push(file);
    grouped.set(pkg, existing);
  }

  return grouped;
}

/**
 * Get cross-package dependencies
 */
export async function getCrossPackageDependencies(
  packages: Package[]
): Promise<Map<string, string[]>> {
  const deps = new Map<string, string[]>();

  for (const pkg of packages) {
    const pkgDeps: string[] = [];
    const allDeps = {
      ...pkg.packageJson.dependencies,
      ...pkg.packageJson.devDependencies,
      ...pkg.packageJson.peerDependencies,
    };

    for (const depName of Object.keys(allDeps)) {
      if (packages.some((p) => p.name === depName)) {
        pkgDeps.push(depName);
      }
    }

    if (pkgDeps.length > 0) {
      deps.set(pkg.name, pkgDeps);
    }
  }

  return deps;
}
