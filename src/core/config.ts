import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { WhiteroseConfig, CodebaseUnderstanding as CodebaseUnderstandingSchema } from '../types.js';
import type { CodebaseUnderstanding } from '../types.js';

export async function loadConfig(cwd: string): Promise<WhiteroseConfig> {
  const configPath = join(cwd, '.whiterose', 'config.yml');

  if (!existsSync(configPath)) {
    throw new Error('Config file not found. Run "whiterose init" first.');
  }

  const content = readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(content);

  // Apply defaults
  return WhiteroseConfig.parse(parsed);
}

export async function loadUnderstanding(cwd: string): Promise<CodebaseUnderstanding | null> {
  const understandingPath = join(cwd, '.whiterose', 'cache', 'understanding.json');

  if (!existsSync(understandingPath)) {
    return null;
  }

  try {
    const content = readFileSync(understandingPath, 'utf-8');
    const parsed = JSON.parse(content);
    const result = CodebaseUnderstandingSchema.safeParse(parsed);
    if (!result.success) {
      console.error('Warning: Invalid understanding.json, regenerate with "whiterose refresh"');
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

export async function saveConfig(cwd: string, config: WhiteroseConfig): Promise<void> {
  const { writeFileSync } = await import('fs');
  const configPath = join(cwd, '.whiterose', 'config.yml');
  writeFileSync(configPath, YAML.stringify(config), 'utf-8');
}
