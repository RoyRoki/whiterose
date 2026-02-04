# Contributing to whiterose

Thanks for your interest in contributing to whiterose! This document provides guidelines and information for contributors.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/whiterose.git`
3. Install dependencies: `npm install`
4. Build: `npm run build`
5. Create a branch: `git checkout -b feature/your-feature`

## Development

### Building

```bash
npm run build      # Build once
npm run dev        # Watch mode
```

### Type Checking

```bash
npx tsc --noEmit
```

### Testing with Providers

You'll need at least one LLM provider installed:
- Claude Code: `npm install -g @anthropic-ai/claude-code`
- Codex: `npm install -g @openai/codex`
- Gemini: `npm install -g @google/gemini-cli`

## Architecture

Before contributing, please read the [Architecture section in README.md](README.md#architecture).

Key concepts:
- **CoreScanner**: Orchestrates all 19 scanning passes
- **PromptExecutor**: Simple interface for providers (~50 LOC each)
- **Findings flow**: Unit → Integration → E2E passes

### Adding a New Provider

1. Create `src/providers/executors/your-provider.ts`:

```typescript
import { PromptExecutor, PromptOptions, PromptResult } from '../../core/scanner.js';

export class YourProviderExecutor implements PromptExecutor {
  name = 'your-provider';

  async isAvailable(): Promise<boolean> {
    // Check if CLI is installed
  }

  async runPrompt(prompt: string, options: PromptOptions): Promise<PromptResult> {
    // Run: your-cli "prompt"
    // Return: { output, error }
  }
}
```

2. Register in `src/providers/executors/index.ts`
3. Add to `ProviderType` in `src/types.ts`
4. Add detection in `src/providers/detect.ts`

### Adding a New Scanning Pass

1. Add pass config to `src/core/multipass-scanner.ts` (unit) or `src/core/flow-analyzer.ts` (integration/E2E)
2. Add prompt template in `src/providers/prompts/`
3. Add to pipeline in `src/providers/prompts/flow-analysis-prompts.ts`

## Pull Request Process

1. Ensure your code builds: `npm run build`
2. Ensure types are correct: `npx tsc --noEmit`
3. Test with at least one provider
4. Update README.md if adding features
5. Create PR with clear description
6. Wait for review (1 approval required)

## Code Style

- TypeScript strict mode
- No `any` types (use `unknown` if needed)
- Descriptive variable names
- Comments for non-obvious logic
- Keep functions focused (SRP)

## Commit Messages

Format: `type(scope): description`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
- `feat(scanner): add new injection detection pass`
- `fix(codex): use correct CLI flags for fix mode`
- `docs: update architecture section`

## Questions?

- Open an issue with the `question` label
- Check existing issues and discussions

## License

By contributing, you agree that your contributions will be licensed under the project's PolyForm Noncommercial 1.0.0 license.
