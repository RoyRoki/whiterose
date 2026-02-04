import fg from 'fast-glob';
import { createHash } from 'crypto';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { WhiteroseConfig, FileHash, CacheState } from '../../types.js';
import { getDependentFiles as getDepGraphDependents } from '../dependencies.js';

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];
const DEFAULT_EXCLUDE = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.d.ts',
  '.whiterose/**',
];

export async function scanCodebase(cwd: string, config?: WhiteroseConfig): Promise<string[]> {
  const include = config?.include || DEFAULT_INCLUDE;
  const exclude = config?.exclude || DEFAULT_EXCLUDE;

  const files = await fg(include, {
    cwd,
    ignore: exclude,
    absolute: true,
    onlyFiles: true,
  });

  return files.sort();
}

export function hashFile(filePath: string): string {
  // Read as buffer to correctly hash any file type (including binary)
  const content = readFileSync(filePath);
  return createHash('md5').update(content).digest('hex');
}

export async function getChangedFiles(
  cwd: string,
  config: WhiteroseConfig,
  options?: { writeCache?: boolean }
): Promise<{ files: string[]; hashes: FileHash[]; state: CacheState }> {
  const cachePath = join(cwd, '.whiterose', 'cache', 'file-hashes.json');

  // Get current files
  const currentFiles = await scanCodebase(cwd, config);

  // Load cached hashes
  let cachedState: CacheState = {
    version: '1',
    fileHashes: [],
  };

  if (existsSync(cachePath)) {
    try {
      const parsed = JSON.parse(readFileSync(cachePath, 'utf-8'));
      // Validate fileHashes exists and is an array
      if (Array.isArray(parsed.fileHashes)) {
        cachedState = parsed;
      }
    } catch {
      // Corrupted cache, use default empty state
    }
  }

  const cachedHashes = new Map(cachedState.fileHashes.map((h) => [h.path, h.hash]));

  // Find changed files
  const changedFiles: string[] = [];
  const newHashes: FileHash[] = [];

  for (const file of currentFiles) {
    const relativePath = relative(cwd, file);
    const currentHash = hashFile(file);

    newHashes.push({
      path: relativePath,
      hash: currentHash,
      lastModified: new Date().toISOString(),
    });

    const cachedHash = cachedHashes.get(relativePath);
    if (!cachedHash || cachedHash !== currentHash) {
      changedFiles.push(file);
    }
  }

  // Prepare updated cache state (write only if requested)
  const newState: CacheState = {
    version: '1',
    lastIncrementalScan: new Date().toISOString(),
    lastFullScan: cachedState.lastFullScan,
    fileHashes: newHashes,
  };

  if (options?.writeCache !== false) {
    writeFileSync(cachePath, JSON.stringify(newState, null, 2), 'utf-8');
  }

  return { files: changedFiles, hashes: newHashes, state: newState };
}

export function saveFileHashes(cwd: string, state: CacheState): void {
  const cachePath = join(cwd, '.whiterose', 'cache', 'file-hashes.json');
  writeFileSync(cachePath, JSON.stringify(state, null, 2), 'utf-8');
}

export async function getDependentFiles(
  changedFiles: string[],
  cwd: string,
  allFiles?: string[]
): Promise<string[]> {
  // Use the dependency graph to find all files that depend on changed files
  return getDepGraphDependents(changedFiles, cwd, allFiles);
}
