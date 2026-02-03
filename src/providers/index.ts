import { LLMProvider, ProviderType } from '../types.js';
import { ClaudeCodeProvider } from './adapters/claude-code.js';
import { AiderProvider } from './adapters/aider.js';

const providers: Record<ProviderType, () => LLMProvider> = {
  'claude-code': () => new ClaudeCodeProvider(),
  aider: () => new AiderProvider(),
  codex: () => {
    throw new Error('Codex provider not yet implemented');
  },
  opencode: () => {
    throw new Error('OpenCode provider not yet implemented');
  },
  ollama: () => {
    throw new Error('Ollama provider not yet implemented');
  },
};

export async function getProvider(name: ProviderType): Promise<LLMProvider> {
  const factory = providers[name];
  if (!factory) {
    throw new Error(`Unknown provider: ${name}`);
  }

  const provider = factory();

  // Check if provider is available
  const available = await provider.isAvailable();
  if (!available) {
    throw new Error(`Provider ${name} is not available. Make sure it's installed and configured.`);
  }

  return provider;
}

export { ClaudeCodeProvider, AiderProvider };
