import { existsSync, readFileSync } from 'fs';
import { join, resolve, isAbsolute, relative } from 'path';
import { Bug, CodebaseUnderstanding, FindingKind } from '../types.js';
import { parseIntentDocument } from './contracts/intent.js';

interface IntentContext {
  constraints: string[];
  contracts: CodebaseUnderstanding['contracts'];
}

export function loadIntentContext(cwd: string, understanding: CodebaseUnderstanding): IntentContext {
  const intentPath = join(cwd, '.whiterose', 'intent.md');
  let constraints: string[] = [];

  if (existsSync(intentPath)) {
    try {
      const content = readFileSync(intentPath, 'utf-8');
      const parsed = parseIntentDocument(content);
      const featureConstraints = parsed.customFeatures.flatMap((f) => f.constraints || []);
      constraints = [...parsed.knownConstraints, ...featureConstraints];
    } catch {
      // Ignore intent parsing errors
    }
  }

  // Add constraints from understanding features if present
  if (understanding.features?.length) {
    for (const feature of understanding.features) {
      if (feature.constraints?.length) {
        constraints.push(...feature.constraints);
      }
    }
  }

  return {
    constraints,
    contracts: understanding.contracts || [],
  };
}

export function classifyFindings(
  bugs: Bug[],
  cwd: string,
  understanding: CodebaseUnderstanding
): Bug[] {
  const intent = loadIntentContext(cwd, understanding);

  return bugs.map((bug) => {
    const relatedContract = findRelatedContract(bug, cwd, intent.contracts);
    const constraintMatch = matchesConstraint(bug, intent.constraints);

    if (relatedContract && !bug.relatedContract) {
      bug.relatedContract = relatedContract;
    }

    const hasConcreteEvidence = hasEvidenceOfFailure(bug);
    const strongConfidence =
      bug.confidence.overall === 'high' &&
      bug.confidence.reachability >= 0.7 &&
      bug.confidence.codePathValidity >= 0.7;

    let verified = strongConfidence || (hasConcreteEvidence && bug.confidence.reachability >= 0.5);

    const isIntentClaim =
      bug.category === 'intent-violation' || bug.confidence.intentViolation === true;

    if (isIntentClaim) {
      verified = verified && (Boolean(relatedContract) || constraintMatch);
    }

    if ((bug.severity === 'critical' || bug.severity === 'high') && !hasConcreteEvidence) {
      verified = false;
    }

    bug.kind = (verified ? 'bug' : 'smell') as FindingKind;

    return bug;
  });
}

export function analyzeIntentContracts(
  cwd: string,
  understanding: CodebaseUnderstanding
): Bug[] {
  const bugs: Bug[] = [];

  for (const contract of understanding.contracts || []) {
    const absoluteFile = normalizeFilePath(contract.file, cwd);
    if (!existsSync(absoluteFile)) {
      bugs.push(makeIntentBug(cwd, contract, 'Contract file missing'));
      continue;
    }

    const content = readFileSync(absoluteFile, 'utf-8');
    if (!functionExists(content, contract.function)) {
      bugs.push(makeIntentBug(cwd, contract, `Contract function not found: ${contract.function}`));
    }
  }

  return bugs;
}

function normalizeFilePath(filePath: string, cwd: string): string {
  if (!filePath) return filePath;
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function findRelatedContract(
  bug: Bug,
  cwd: string,
  contracts: CodebaseUnderstanding['contracts']
): string | undefined {
  const bugFile = normalizeFilePath(bug.file, cwd);
  const title = bug.title.toLowerCase();

  for (const contract of contracts) {
    const contractFile = normalizeFilePath(contract.file, cwd);
    if (!bugFile.endsWith(contractFile) && bugFile !== contractFile) continue;

    const fn = contract.function.toLowerCase();
    const inTitle = title.includes(fn);
    const inPath = bug.codePath.some((s) => (s.file || '').toLowerCase().includes(fn));

    if (inTitle || inPath) {
      return `${contract.file}:${contract.function}()`;
    }
  }

  return undefined;
}

function matchesConstraint(bug: Bug, constraints: string[]): boolean {
  if (constraints.length === 0) return false;

  const text = [
    bug.title,
    bug.description,
    ...(bug.evidence || []),
  ]
    .join(' ')
    .toLowerCase();

  for (const constraint of constraints) {
    const normalized = constraint.toLowerCase();
    if (!normalized) continue;
    if (text.includes(normalized)) return true;

    const keywords = normalized
      .split(/\W+/)
      .filter((w) => w.length >= 4);
    if (keywords.some((k) => text.includes(k))) {
      return true;
    }
  }

  return false;
}

function hasEvidenceOfFailure(bug: Bug): boolean {
  if (bug.codePath && bug.codePath.length > 0) return true;

  const text = [
    bug.title,
    bug.description,
    ...(bug.evidence || []),
  ]
    .join(' ')
    .toLowerCase();

  return /repro|reproduce|fail|fails|failing|throws|throw|crash|exception|incorrect|broken|violate/.test(text);
}

function functionExists(content: string, functionName: string): boolean {
  if (!functionName) return false;
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\bfunction\\s+${escaped}\\b`),
    new RegExp(`\\bconst\\s+${escaped}\\s*=\\s*`),
    new RegExp(`\\blet\\s+${escaped}\\s*=\\s*`),
    new RegExp(`\\b${escaped}\\s*\\(`),
  ];
  return patterns.some((p) => p.test(content));
}

function makeIntentBug(
  cwd: string,
  contract: CodebaseUnderstanding['contracts'][number],
  reason: string
): Bug {
  return {
    id: `INTENT-${Math.random().toString(36).slice(2, 8)}`,
    title: `Intent contract mismatch: ${contract.function}`,
    description: reason,
    file: relative(cwd, normalizeFilePath(contract.file, cwd)),
    line: 1,
    severity: 'high',
    category: 'intent-violation',
    kind: 'bug',
    confidence: {
      overall: 'high',
      codePathValidity: 0.8,
      reachability: 0.8,
      intentViolation: true,
      staticToolSignal: false,
      adversarialSurvived: false,
    },
    codePath: [],
    evidence: [reason],
    relatedContract: `${contract.file}:${contract.function}()`,
    createdAt: new Date().toISOString(),
    status: 'open',
  };
}
