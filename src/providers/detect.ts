import { execa } from 'execa';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ProviderType } from '../types.js';

interface ProviderCheck {
  name: ProviderType;
  command: string;
  args: string[];
  // Common installation paths to check
  paths?: string[];
}

const providerChecks: ProviderCheck[] = [
  {
    name: 'claude-code',
    command: 'claude',
    args: ['--version'],
    paths: [
      join(homedir(), '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ],
  },
  {
    name: 'aider',
    command: 'aider',
    args: ['--version'],
    paths: [
      join(homedir(), '.local', 'bin', 'aider'),
      '/usr/local/bin/aider',
      '/opt/homebrew/bin/aider',
    ],
  },
  {
    name: 'codex',
    command: 'codex',
    args: ['--version'],
    paths: [
      join(homedir(), '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/opt/homebrew/bin/codex',
    ],
  },
  {
    name: 'opencode',
    command: 'opencode',
    args: ['--version'],
    paths: [
      join(homedir(), '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/opt/homebrew/bin/opencode',
    ],
  },
  {
    name: 'gemini',
    command: 'gemini',
    args: ['--version'],
    paths: [
      join(homedir(), '.local', 'bin', 'gemini'),
      '/usr/local/bin/gemini',
      '/opt/homebrew/bin/gemini',
    ],
  },
  {
    name: 'ollama',
    command: 'ollama',
    args: ['--version'],
    paths: [
      join(homedir(), '.local', 'bin', 'ollama'),
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
    ],
  },
];

// Cache resolved command paths
const resolvedPaths: Map<ProviderType, string> = new Map();

/**
 * Find the actual command path, checking common installation locations
 */
async function findCommand(check: ProviderCheck): Promise<string | null> {
  // First try the command directly (in case it's in PATH)
  try {
    await execa(check.command, check.args, { timeout: 5000 });
    return check.command;
  } catch {
    // Not in PATH, check common paths
  }

  // Check common installation paths
  if (check.paths) {
    for (const path of check.paths) {
      if (existsSync(path)) {
        try {
          await execa(path, check.args, { timeout: 5000 });
          return path;
        } catch {
          // Path exists but command failed, continue
        }
      }
    }
  }

  return null;
}

export async function detectProvider(): Promise<ProviderType[]> {
  const available: ProviderType[] = [];

  for (const check of providerChecks) {
    const commandPath = await findCommand(check);
    if (commandPath) {
      resolvedPaths.set(check.name, commandPath);
      available.push(check.name);
    }
  }

  return available;
}

export async function isProviderAvailable(name: ProviderType): Promise<boolean> {
  const check = providerChecks.find((c) => c.name === name);
  if (!check) return false;

  const commandPath = await findCommand(check);
  if (commandPath) {
    resolvedPaths.set(name, commandPath);
    return true;
  }
  return false;
}

/**
 * Get the resolved command path for a provider.
 * Returns the cached path if available, otherwise uses the default command name.
 */
export function getProviderCommand(name: ProviderType): string {
  // Check if we have a cached resolved path
  const cached = resolvedPaths.get(name);
  if (cached) return cached;

  // Fallback to the provider's expected command name
  const check = providerChecks.find((c) => c.name === name);
  return check?.command || name;
}
