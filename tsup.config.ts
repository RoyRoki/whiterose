import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI build with shebang
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    minify: false,
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    // Mark TypeScript as external - it uses dynamic require() which breaks in ESM bundles
    external: ['typescript'],
  },
  // Library build without shebang
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false, // Don't clean since CLI already built
    splitting: false,
    treeshake: true,
    minify: false,
    target: 'node18',
    // Mark TypeScript as external - it uses dynamic require() which breaks in ESM bundles
    external: ['typescript'],
  },
]);
