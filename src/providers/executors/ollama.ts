/**
 * Ollama Executor - Local LLM support
 *
 * Runs prompts via local Ollama server.
 * Requires: ollama installed and a model pulled (e.g., ollama pull codellama)
 */

import { execa } from 'execa';
import { PromptExecutor, PromptOptions, PromptResult } from '../../core/scanner.js';
import { isProviderAvailable, getProviderCommand } from '../detect.js';

const OLLAMA_TIMEOUT = 600000; // 10 minutes (local models can be slow)
const DEFAULT_MODEL = 'codellama'; // Good for code analysis

export class OllamaExecutor implements PromptExecutor {
  name = 'ollama';
  private model: string;

  constructor(model: string = DEFAULT_MODEL) {
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    return isProviderAvailable('ollama');
  }

  async runPrompt(prompt: string, options: PromptOptions): Promise<PromptResult> {
    const ollamaCommand = getProviderCommand('ollama');

    try {
      const { stdout, stderr } = await execa(
        ollamaCommand,
        ['run', this.model, prompt],
        {
          cwd: options.cwd,
          timeout: options.timeout || OLLAMA_TIMEOUT,
          env: {
            ...process.env,
            NO_COLOR: '1',
          },
          reject: false,
        }
      );

      return {
        output: stdout || '',
        error: stderr || undefined,
      };
    } catch (error: any) {
      if (error.message?.includes('ENOENT')) {
        throw new Error('Ollama not found. Install from: https://ollama.ai');
      }
      if (error.message?.includes('model') && error.message?.includes('not found')) {
        throw new Error(`Ollama model '${this.model}' not found. Run: ollama pull ${this.model}`);
      }
      throw error;
    }
  }
}
