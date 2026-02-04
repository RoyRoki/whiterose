import { ScanResult, Bug } from '../types.js';

interface SarifResult {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResultItem[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  defaultConfiguration: { level: string };
  properties: { category: string };
}

interface SarifResultItem {
  ruleId: string;
  level: string;
  message: { text: string; markdown?: string };
  locations: SarifLocation[];
  codeFlows?: SarifCodeFlow[];
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: number; endLine?: number };
  };
}

interface SarifCodeFlow {
  threadFlows: {
    locations: {
      location: SarifLocation;
      message?: { text: string };
    }[];
  }[];
}

export function outputSarif(result: ScanResult): SarifResult {
  const rules: SarifRule[] = [];
  const results: SarifResultItem[] = [];

  // Build unique rules from bugs
  const seenRules = new Set<string>();

  for (const bug of result.bugs) {
    // Create rule if not seen
    if (!seenRules.has(bug.category)) {
      seenRules.add(bug.category);
      rules.push({
        id: bug.category,
        name: formatRuleName(bug.category),
        shortDescription: { text: getCategoryDescription(bug.category) },
        fullDescription: { text: getCategoryDescription(bug.category) },
        defaultConfiguration: { level: 'warning' },
        properties: { category: bug.category },
      });
    }

    // Create result
    results.push(bugToSarifResult(bug));
  }

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'whiterose',
            version: '0.1.0',
            informationUri: 'https://github.com/shakecodeslikecray/whiterose',
            rules,
          },
        },
        results,
      },
    ],
  };
}

function bugToSarifResult(bug: Bug): SarifResultItem {
  const result: SarifResultItem = {
    ruleId: bug.id,
    level: severityToLevel(bug.severity),
    message: {
      text: bug.title,
      markdown: `**${bug.title}**\n\n${bug.description}\n\n**Evidence:**\n${bug.evidence.map((e) => `- ${e}`).join('\n')}`,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: bug.file },
          region: { startLine: bug.line, endLine: bug.endLine },
        },
      },
    ],
  };

  // Add code flow if available
  if (bug.codePath.length > 0) {
    result.codeFlows = [
      {
        threadFlows: [
          {
            locations: bug.codePath.map((step) => ({
              location: {
                physicalLocation: {
                  artifactLocation: { uri: step.file },
                  region: { startLine: step.line },
                },
              },
              message: { text: step.explanation },
            })),
          },
        ],
      },
    ];
  }

  return result;
}

function severityToLevel(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'error';
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'note';
    default:
      return 'warning';
  }
}

function formatRuleName(category: string): string {
  return category
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getCategoryDescription(category: string): string {
  const descriptions: Record<string, string> = {
    // Security
    'injection': 'Injection vulnerabilities including SQL, command, and code injection',
    'auth-bypass': 'Authentication and authorization bypass vulnerabilities',
    'secrets-exposure': 'Exposure of secrets, credentials, or sensitive data',
    // Reliability
    'null-reference': 'Potential null or undefined reference issues',
    'boundary-error': 'Boundary errors including off-by-one and array index issues',
    'resource-leak': 'Resource leaks such as unclosed handles or connections',
    'async-issue': 'Async/concurrency issues like race conditions and missing awaits',
    // Correctness
    'logic-error': 'Logic errors such as wrong operators or incorrect conditions',
    'data-validation': 'Missing or improper input validation',
    'type-coercion': 'Type coercion bugs that may cause unexpected behavior',
    // Design
    'concurrency': 'Thread safety and deadlock issues',
    'intent-violation': 'Violations of documented behavioral contracts or business rules',
  };

  return descriptions[category] || 'Unknown bug category';
}
