# whiterose Roadmap

> AI-powered bug hunter that finds real bugs, not style issues.

## Vision

whiterose aims to be the most effective AI-powered static analysis tool that understands code intent and finds bugs that traditional linters miss. We leverage LLM reasoning to trace code paths, understand business logic, and identify genuine issues.

---

## v1.0.0 - Foundation (Current)

**Status**: Released

### Core Features
- [x] Interactive CLI wizard with auto-detection
- [x] Bug scanning with code path analysis
- [x] Adversarial validation (devil's advocate pass)
- [x] Multi-format output (Terminal, Markdown, SARIF, JSON)
- [x] Codebase understanding/documentation generation
- [x] Confidence scoring system
- [x] Security hardening (path traversal prevention, opt-in unsafe mode)

### LLM Providers
- [x] **claude-code** - Anthropic's Claude Code CLI
- [x] **aider** - AI pair programming tool

### Language Support
- [x] TypeScript / JavaScript
- [x] Python (basic)
- [x] Go (basic)
- [x] Any language the LLM understands (generic support)

---

## v1.1.0 - Provider Expansion

**Status**: Planned

### New LLM Providers
- [ ] **Cursor CLI** - Cursor editor's AI capabilities
- [ ] **GitHub Copilot CLI** - `gh copilot` integration
- [ ] Provider auto-installation prompts

### Improvements
- [ ] Better progress indicators
- [ ] Scan resumption (continue interrupted scans)
- [ ] Configuration presets (quick, balanced, thorough)

---

## v1.2.0 - Framework Intelligence

**Status**: Planned

### Framework-Specific Analysis
- [ ] **React/Next.js** - Hook dependency bugs, hydration issues
- [ ] **Express/Fastify** - Middleware ordering, async error handling
- [ ] **NestJS** - Dependency injection issues, decorator misuse
- [ ] **Django/FastAPI** - ORM issues, async context bugs

### Enhanced Detection
- [ ] Cross-file data flow analysis
- [ ] API contract validation
- [ ] Database query analysis (N+1, injection risks)

---

## v1.3.0 - Integration & Reporting

**Status**: Planned

### CI/CD Integration
- [ ] GitHub Actions workflow generator
- [ ] GitLab CI template
- [ ] Pre-commit hook support
- [ ] PR comment bot (post findings as review comments)

### Reporting
- [ ] HTML report generation
- [ ] Trend analysis (compare scans over time)
- [ ] Bug categorization dashboard
- [ ] Export to issue trackers (GitHub, Jira, Linear)

---

## v2.0.0 - Agent Architecture

**Status**: Future

### Direct API Support
- [ ] Claude API (Anthropic) with own API key
- [ ] OpenAI API (GPT-4) with own API key
- [ ] Local LLMs (Ollama, llama.cpp)
- [ ] Custom endpoint support

### Agent Capabilities
- [ ] Multi-turn reasoning for complex bugs
- [ ] Automatic fix generation and application
- [ ] Interactive bug exploration mode
- [ ] Context window optimization

### Enterprise Features
- [ ] Team configuration sharing
- [ ] Centralized bug database
- [ ] Custom rule definitions
- [ ] Compliance reporting (SOC2, HIPAA patterns)

---

## v2.1.0 - Self-Healing

**Status**: Future

### Autonomous Fixes
- [ ] Auto-fix with test verification
- [ ] PR creation with fix explanations
- [ ] Rollback on test failure
- [ ] Fix confidence scoring

---

## Language Support Roadmap

| Language | v1.0 | v1.2 | v2.0 |
|----------|------|------|------|
| TypeScript/JavaScript | Full | Full | Full |
| Python | Basic | Full | Full |
| Go | Basic | Full | Full |
| Rust | - | Basic | Full |
| Java/Kotlin | - | Basic | Full |
| C/C++ | - | - | Basic |
| Ruby | - | Basic | Full |
| PHP | - | Basic | Full |
| Swift | - | - | Basic |
| C# | - | Basic | Full |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to whiterose.

### Priority Areas
1. **New LLM providers** - Adding support for more AI tools
2. **Framework analyzers** - Framework-specific bug patterns
3. **Language support** - Better parsing for more languages
4. **Bug patterns** - New categories of bugs to detect

---

## Versioning

whiterose follows [Semantic Versioning](https://semver.org/):
- **Major** (x.0.0): Breaking changes, new architecture
- **Minor** (0.x.0): New features, providers, backwards compatible
- **Patch** (0.0.x): Bug fixes, performance improvements
