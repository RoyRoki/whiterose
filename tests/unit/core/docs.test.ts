import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import fg from 'fast-glob';
import {
  readExistingDocs,
  extractIntentFromDocs,
  buildDocsSummary,
  ExistingDocs,
  ExtractedIntent,
} from '../../../src/core/docs';

describe('core/docs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readExistingDocs', () => {
    it('should return empty docs when no files exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.readme).toBeNull();
      expect(result.contributing).toBeNull();
      expect(result.changelog).toBeNull();
      expect(result.packageJson).toBeNull();
      expect(result.tsconfig).toBeNull();
      expect(result.envExample).toBeNull();
      expect(result.apiDocs).toEqual([]);
      expect(result.otherDocs).toEqual([]);
    });

    it('should read README.md', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('README.md');
      });
      vi.mocked(readFileSync).mockReturnValue('# Project\nThis is a readme');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.readme).toBe('# Project\nThis is a readme');
    });

    it('should read lowercase readme.md', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('readme.md');
      });
      vi.mocked(readFileSync).mockReturnValue('# Readme');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.readme).toBe('# Readme');
    });

    it('should read CONTRIBUTING.md', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('CONTRIBUTING.md');
      });
      vi.mocked(readFileSync).mockReturnValue('# Contributing Guidelines');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.contributing).toBe('# Contributing Guidelines');
    });

    it('should read CHANGELOG.md', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('CHANGELOG.md');
      });
      vi.mocked(readFileSync).mockReturnValue('# Changelog');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.changelog).toBe('# Changelog');
    });

    it('should read package.json', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('package.json');
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'test-project' }));
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.packageJson).toEqual({ name: 'test-project' });
    });

    it('should handle invalid package.json', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('package.json');
      });
      vi.mocked(readFileSync).mockReturnValue('not valid json');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.packageJson).toBeNull();
    });

    it('should read tsconfig.json', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('tsconfig.json');
      });
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ compilerOptions: {} }));
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.tsconfig).toEqual({ compilerOptions: {} });
    });

    it('should handle invalid tsconfig.json', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('tsconfig.json');
      });
      vi.mocked(readFileSync).mockReturnValue('invalid json');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.tsconfig).toBeNull();
    });

    it('should read .env.example', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.env.example');
      });
      vi.mocked(readFileSync).mockReturnValue('DATABASE_URL=postgres://...');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.envExample).toBe('DATABASE_URL=postgres://...');
    });

    it('should read .env.sample as fallback', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        return path.endsWith('.env.sample');
      });
      vi.mocked(readFileSync).mockReturnValue('API_KEY=xxx');
      vi.mocked(fg).mockResolvedValue([]);

      const result = await readExistingDocs('/project');

      expect(result.envExample).toBe('API_KEY=xxx');
    });

    it('should read API docs from docs folder', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fg).mockImplementation((patterns: any) => {
        if (patterns[0].includes('docs/')) {
          return Promise.resolve(['/project/docs/api.md']);
        }
        return Promise.resolve([]);
      });
      vi.mocked(readFileSync).mockReturnValue('# API Documentation');

      const result = await readExistingDocs('/project');

      expect(result.apiDocs).toContain('# API Documentation');
    });

    it('should limit API docs to 10 files', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fg).mockImplementation((patterns: any) => {
        if (patterns[0].includes('docs/')) {
          return Promise.resolve(
            Array.from({ length: 15 }, (_, i) => `/project/docs/api${i}.md`)
          );
        }
        return Promise.resolve([]);
      });
      vi.mocked(readFileSync).mockReturnValue('# API Doc');

      const result = await readExistingDocs('/project');

      expect(result.apiDocs.length).toBe(10);
    });

    it('should read other markdown docs', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fg).mockImplementation((patterns: any) => {
        if (patterns[0] === '*.md') {
          return Promise.resolve(['/project/SECURITY.md']);
        }
        return Promise.resolve([]);
      });
      vi.mocked(readFileSync).mockReturnValue('# Security Policy');

      const result = await readExistingDocs('/project');

      expect(result.otherDocs).toEqual([
        { name: 'SECURITY.md', content: '# Security Policy' },
      ]);
    });

    it('should skip unreadable files', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fg).mockImplementation((patterns: any) => {
        if (patterns[0].includes('docs/')) {
          return Promise.resolve(['/project/docs/api.md']);
        }
        return Promise.resolve([]);
      });
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await readExistingDocs('/project');

      expect(result.apiDocs).toEqual([]);
    });
  });

  describe('extractIntentFromDocs', () => {
    const emptyDocs: ExistingDocs = {
      readme: null,
      contributing: null,
      apiDocs: [],
      changelog: null,
      packageJson: null,
      tsconfig: null,
      envExample: null,
      otherDocs: [],
    };

    it('should return empty intent for empty docs', () => {
      const result = extractIntentFromDocs(emptyDocs);

      expect(result.projectName).toBe('');
      expect(result.description).toBe('');
      expect(result.features).toEqual([]);
      expect(result.techStack).toEqual([]);
      expect(result.conventions).toEqual([]);
      expect(result.apiEndpoints).toEqual([]);
      expect(result.envVariables).toEqual([]);
      expect(result.scripts).toEqual({});
    });

    it('should extract project name and description from package.json', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          name: 'my-awesome-project',
          description: 'An awesome project',
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.projectName).toBe('my-awesome-project');
      expect(result.description).toBe('An awesome project');
    });

    it('should extract scripts from package.json', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          name: 'test',
          scripts: {
            build: 'tsc',
            test: 'vitest',
          },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.scripts).toEqual({
        build: 'tsc',
        test: 'vitest',
      });
    });

    it('should detect Next.js in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { next: '^14.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Next.js');
    });

    it('should detect React in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { react: '^18.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('React');
    });

    it('should detect Vue in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { vue: '^3.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Vue');
    });

    it('should detect Express in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { express: '^4.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Express');
    });

    it('should detect Fastify in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { fastify: '^4.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Fastify');
    });

    it('should detect TypeScript in tech stack from devDependencies', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          devDependencies: { typescript: '^5.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('TypeScript');
    });

    it('should detect Prisma in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { prisma: '^5.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Prisma');
    });

    it('should detect MongoDB/Mongoose in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { mongoose: '^7.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('MongoDB/Mongoose');
    });

    it('should detect PostgreSQL in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { pg: '^8.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('PostgreSQL');
    });

    it('should detect Redis in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { redis: '^4.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Redis');
    });

    it('should detect Stripe in tech stack', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { stripe: '^12.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Stripe');
    });

    it('should detect Auth.js from @auth/core', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { '@auth/core': '^1.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Auth.js');
    });

    it('should detect Auth.js from next-auth', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        packageJson: {
          dependencies: { 'next-auth': '^4.0.0' },
        },
      };

      const result = extractIntentFromDocs(docs);

      expect(result.techStack).toContain('Auth.js');
    });

    it('should extract features from README', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        readme: `# Project

## Features
- Fast performance
- Easy to use
* Another feature

## Installation
`,
      };

      const result = extractIntentFromDocs(docs);

      expect(result.features).toContain('Fast performance');
      expect(result.features).toContain('Easy to use');
      expect(result.features).toContain('Another feature');
    });

    it('should limit features to 20', () => {
      const features = Array.from({ length: 30 }, (_, i) => `- Feature ${i}`).join('\n');
      const docs: ExistingDocs = {
        ...emptyDocs,
        readme: `# Project\n\n## Features\n${features}\n\n## Installation`,
      };

      const result = extractIntentFromDocs(docs);

      expect(result.features.length).toBe(20);
    });

    it('should extract env variables from .env.example', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        envExample: `# Database
DATABASE_URL=postgres://localhost/db
# API
API_KEY=your-api-key
SECRET=your-secret`,
      };

      const result = extractIntentFromDocs(docs);

      expect(result.envVariables).toContain('DATABASE_URL');
      expect(result.envVariables).toContain('API_KEY');
      expect(result.envVariables).toContain('SECRET');
    });

    it('should extract API endpoints from docs', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        apiDocs: [
          '# API\n`GET /users`\n`POST /users`\n`DELETE /users/:id`',
          '`PUT /posts/:id`',
        ],
      };

      const result = extractIntentFromDocs(docs);

      expect(result.apiEndpoints).toContain('GET /users');
      expect(result.apiEndpoints).toContain('POST /users');
      expect(result.apiEndpoints).toContain('DELETE /users/:id');
      expect(result.apiEndpoints).toContain('PUT /posts/:id');
    });

    it('should extract conventions from CONTRIBUTING', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        contributing: `# Contributing

## Guidelines
- Use TypeScript for all new code
- Write tests for all new features
- Short line

---`,
      };

      const result = extractIntentFromDocs(docs);

      expect(result.conventions).toContain('Use TypeScript for all new code');
      expect(result.conventions).toContain('Write tests for all new features');
      expect(result.conventions).not.toContain('Short line'); // Too short (<10 chars)
    });

    it('should limit conventions to 10', () => {
      const conventions = Array.from(
        { length: 15 },
        (_, i) => `- Convention ${i} with enough length to pass filter`
      ).join('\n');
      const docs: ExistingDocs = {
        ...emptyDocs,
        contributing: `# Contributing\n${conventions}`,
      };

      const result = extractIntentFromDocs(docs);

      expect(result.conventions.length).toBe(10);
    });
  });

  describe('buildDocsSummary', () => {
    const emptyDocs: ExistingDocs = {
      readme: null,
      contributing: null,
      apiDocs: [],
      changelog: null,
      packageJson: null,
      tsconfig: null,
      envExample: null,
      otherDocs: [],
    };

    const emptyIntent: ExtractedIntent = {
      projectName: '',
      description: '',
      features: [],
      techStack: [],
      conventions: [],
      apiEndpoints: [],
      envVariables: [],
      scripts: {},
    };

    it('should generate basic summary', () => {
      const result = buildDocsSummary(emptyDocs, emptyIntent);

      expect(result).toContain('# Existing Documentation Summary');
    });

    it('should include project name', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        projectName: 'test-project',
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('## Project: test-project');
    });

    it('should include description', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        projectName: 'test-project',
        description: 'A test project',
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('A test project');
    });

    it('should include tech stack', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        techStack: ['React', 'TypeScript'],
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('## Tech Stack');
      expect(result).toContain('- React');
      expect(result).toContain('- TypeScript');
    });

    it('should include features', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        features: ['Fast', 'Reliable'],
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('## Features (from README)');
      expect(result).toContain('- Fast');
      expect(result).toContain('- Reliable');
    });

    it('should include API endpoints', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        apiEndpoints: ['GET /users', 'POST /users'],
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('## API Endpoints');
      expect(result).toContain('- GET /users');
      expect(result).toContain('- POST /users');
    });

    it('should limit API endpoints to 20', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        apiEndpoints: Array.from({ length: 25 }, (_, i) => `GET /endpoint${i}`),
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('- GET /endpoint0');
      expect(result).toContain('- GET /endpoint19');
      expect(result).not.toContain('- GET /endpoint20');
    });

    it('should include env variables', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        envVariables: ['DATABASE_URL', 'API_KEY'],
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('## Environment Variables');
      expect(result).toContain('- DATABASE_URL');
      expect(result).toContain('- API_KEY');
    });

    it('should include conventions', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        conventions: ['Use TypeScript', 'Write tests'],
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('## Conventions (from CONTRIBUTING)');
      expect(result).toContain('- Use TypeScript');
      expect(result).toContain('- Write tests');
    });

    it('should include npm scripts', () => {
      const intent: ExtractedIntent = {
        ...emptyIntent,
        scripts: {
          build: 'tsc',
          test: 'vitest',
        },
      };

      const result = buildDocsSummary(emptyDocs, intent);

      expect(result).toContain('## NPM Scripts');
      expect(result).toContain('`npm run build`: tsc');
      expect(result).toContain('`npm run test`: vitest');
    });

    it('should limit npm scripts to 10', () => {
      const scripts: Record<string, string> = {};
      for (let i = 0; i < 15; i++) {
        scripts[`script${i}`] = `cmd${i}`;
      }
      const intent: ExtractedIntent = {
        ...emptyIntent,
        scripts,
      };

      const result = buildDocsSummary(emptyDocs, intent);

      // Count the number of npm run lines
      const matches = result.match(/`npm run /g) || [];
      expect(matches.length).toBe(10);
    });

    it('should include README excerpt', () => {
      const docs: ExistingDocs = {
        ...emptyDocs,
        readme: '# My Project\n\nThis is my project readme.',
      };

      const result = buildDocsSummary(docs, emptyIntent);

      expect(result).toContain('## README Excerpt');
      expect(result).toContain('# My Project');
      expect(result).toContain('This is my project readme.');
    });

    it('should truncate long README to 2000 characters', () => {
      const longContent = 'A'.repeat(3000);
      const docs: ExistingDocs = {
        ...emptyDocs,
        readme: longContent,
      };

      const result = buildDocsSummary(docs, emptyIntent);

      // The excerpt should be 2000 characters, not the full 3000
      expect(result).toContain('A'.repeat(2000));
      expect(result).not.toContain('A'.repeat(2001));
    });
  });
});
