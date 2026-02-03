import { execa } from 'execa';
import { ProviderType } from '../types.js';

interface ProviderCheck {
  name: ProviderType;
  command: string;
  args: string[];
}

const providerChecks: ProviderCheck[] = [
  {
    name: 'claude-code',
    command: 'claude',
    args: ['--version'],
  },
  {
    name: 'aider',
    command: 'aider',
    args: ['--version'],
  },
  {
    name: 'codex',
    command: 'codex',
    args: ['--version'],
  },
  {
    name: 'opencode',
    command: 'opencode',
    args: ['--version'],
  },
];

export async function detectProvider(): Promise<ProviderType[]> {
  const available: ProviderType[] = [];

  for (const check of providerChecks) {
    try {
      await execa(check.command, check.args, { timeout: 5000 });
      available.push(check.name);
    } catch {
      // Provider not available, skip
    }
  }

  return available;
}

export async function isProviderAvailable(name: ProviderType): Promise<boolean> {
  const check = providerChecks.find((c) => c.name === name);
  if (!check) return false;

  try {
    await execa(check.command, check.args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
