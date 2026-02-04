import { LLMProvider, ProviderType } from '../types.js';
import { ClaudeCodeProvider } from './adapters/claude-code.js';
import { AiderProvider } from './adapters/aider.js';
import { CodexProvider } from './adapters/codex.js';
import { OllamaProvider } from './adapters/ollama.js';
// OpenAI API provider kept for v2 API-based access
// import { OpenAIProvider } from './adapters/openai.js';

const providers: Record<ProviderType, () => LLMProvider> = {
  'claude-code': () => new ClaudeCodeProvider(),
  aider: () => new AiderProvider(),
  codex: () => new CodexProvider(), // OpenAI Codex CLI
  opencode: () => {
    throw new Error('OpenCode provider not yet implemented');
  },
  ollama: () => new OllamaProvider(), // Local LLMs via Ollama
  gemini: () => {
    throw new Error('Gemini provider not yet implemented');
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

export { ClaudeCodeProvider, AiderProvider, CodexProvider, OllamaProvider };
