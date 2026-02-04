# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in whiterose, please report it responsibly.

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email the maintainer directly at: [create a private security advisory on GitHub]
3. Or use GitHub's private vulnerability reporting: https://github.com/shakecodeslikecray/whiterose/security/advisories/new

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release

### Scope

Security issues we're interested in:
- Command injection via LLM prompts
- Path traversal in file operations
- Credential exposure
- Arbitrary code execution
- Privilege escalation

Out of scope:
- Issues in the underlying LLM providers (claude-code, codex, etc.)
- Social engineering attacks
- Issues requiring physical access
