/**
 * AST-Based Code Analysis
 *
 * Uses TypeScript compiler API to extract semantic code units (functions, classes)
 * for smarter, more efficient LLM context building.
 *
 * Key features:
 * - Extract functions/classes with their full context
 * - Identify which functions changed based on line numbers
 * - Extract function signatures of callees (not full implementations)
 * - Extract referenced type definitions
 * - Build optimized context windows for LLM analysis
 */

import * as ts from 'typescript';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CodeUnit {
  type: 'function' | 'method' | 'class' | 'arrow-function' | 'variable';
  name: string;
  startLine: number;
  endLine: number;
  code: string;
  hash: string; // For caching - hash of the code content
  signature?: string; // Function/method signature without body
  className?: string; // For methods, the containing class
  exported: boolean;
  async: boolean;
  parameters: ParameterInfo[];
  returnType?: string;
  calls: string[]; // Functions/methods this unit calls
  references: string[]; // Types/interfaces referenced
}

export interface ParameterInfo {
  name: string;
  type?: string;
  optional: boolean;
  defaultValue?: string;
}

export interface FileAnalysis {
  filePath: string;
  language: 'typescript' | 'javascript';
  units: CodeUnit[];
  imports: ImportInfo[];
  exports: string[];
  types: TypeDefinition[];
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  isTypeOnly: boolean;
  alias?: string;
}

export interface TypeDefinition {
  name: string;
  kind: 'interface' | 'type' | 'enum' | 'class';
  startLine: number;
  endLine: number;
  code: string;
  exported: boolean;
}

export interface ChangedUnit {
  unit: CodeUnit;
  changeType: 'added' | 'modified' | 'deleted';
}

export interface OptimizedContext {
  // Primary: the changed code
  changedUnits: CodeUnit[];
  // Secondary: signatures of functions called by changed code
  calleeSignatures: string[];
  // Tertiary: type definitions referenced
  referencedTypes: TypeDefinition[];
  // Quaternary: imports needed for context
  relevantImports: ImportInfo[];
  // Total estimated tokens (rough)
  estimatedTokens: number;
}

// ─────────────────────────────────────────────────────────────
// Main Analysis Functions
// ─────────────────────────────────────────────────────────────

/**
 * Analyze a TypeScript/JavaScript file and extract all code units
 */
export function analyzeFile(filePath: string): FileAnalysis | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    isTypeScript ? (filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : ts.ScriptKind.JS
  );

  const units: CodeUnit[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];
  const types: TypeDefinition[] = [];

  // Visit all nodes
  function visit(node: ts.Node, className?: string) {
    // Handle imports
    if (ts.isImportDeclaration(node)) {
      const importInfo = extractImport(node, sourceFile);
      if (importInfo) imports.push(importInfo);
    }

    // Handle exports
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      const exportNames = extractExports(node, sourceFile);
      exports.push(...exportNames);
    }

    // Handle type definitions
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      const typeDef = extractTypeDefinition(node, sourceFile, content);
      if (typeDef) types.push(typeDef);
    }

    // Handle functions
    if (ts.isFunctionDeclaration(node) && node.name) {
      const unit = extractFunction(node, sourceFile, content);
      if (unit) units.push(unit);
    }

    // Handle arrow functions assigned to variables
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          const unit = extractArrowFunction(decl, node, sourceFile, content);
          if (unit) units.push(unit);
        }
      }
    }

    // Handle classes
    if (ts.isClassDeclaration(node) && node.name) {
      const classUnit = extractClass(node, sourceFile, content);
      if (classUnit) units.push(classUnit);

      // Extract methods from class
      const currentClassName = node.name.getText(sourceFile);
      node.members.forEach((member) => {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodUnit = extractMethod(member, sourceFile, content, currentClassName);
          if (methodUnit) units.push(methodUnit);
        }
      });
    }

    // Continue traversing
    ts.forEachChild(node, (child) => visit(child, className));
  }

  visit(sourceFile);

  return {
    filePath,
    language: isTypeScript ? 'typescript' : 'javascript',
    units,
    imports,
    exports,
    types,
  };
}

/**
 * Find which code units were affected by changes at specific lines
 */
export function findChangedUnits(
  analysis: FileAnalysis,
  changedLines: number[]
): CodeUnit[] {
  if (changedLines.length === 0) {
    return analysis.units;
  }

  const changedSet = new Set(changedLines);
  const affectedUnits: CodeUnit[] = [];

  for (const unit of analysis.units) {
    // Check if any changed line falls within this unit
    for (let line = unit.startLine; line <= unit.endLine; line++) {
      if (changedSet.has(line)) {
        affectedUnits.push(unit);
        break;
      }
    }
  }

  return affectedUnits;
}

/**
 * Build optimized context for LLM analysis
 * Prioritizes: changed code > callee signatures > types > imports
 */
export function buildOptimizedContext(
  changedUnits: CodeUnit[],
  fileAnalysis: FileAnalysis,
  maxTokens: number = 8000
): OptimizedContext {
  const context: OptimizedContext = {
    changedUnits: [],
    calleeSignatures: [],
    referencedTypes: [],
    relevantImports: [],
    estimatedTokens: 0,
  };

  // Collect all calls and references from changed units
  const allCalls = new Set<string>();
  const allReferences = new Set<string>();

  for (const unit of changedUnits) {
    for (const call of unit.calls) {
      allCalls.add(call);
    }
    for (const ref of unit.references) {
      allReferences.add(ref);
    }
  }

  // Priority 1: Changed code (always include)
  for (const unit of changedUnits) {
    const tokens = estimateTokens(unit.code);
    if (context.estimatedTokens + tokens <= maxTokens) {
      context.changedUnits.push(unit);
      context.estimatedTokens += tokens;
    }
  }

  // Priority 2: Signatures of called functions (not full implementations)
  for (const unit of fileAnalysis.units) {
    if (allCalls.has(unit.name) && unit.signature) {
      const tokens = estimateTokens(unit.signature);
      if (context.estimatedTokens + tokens <= maxTokens) {
        context.calleeSignatures.push(unit.signature);
        context.estimatedTokens += tokens;
      }
    }
  }

  // Priority 3: Referenced type definitions
  for (const typeDef of fileAnalysis.types) {
    if (allReferences.has(typeDef.name)) {
      const tokens = estimateTokens(typeDef.code);
      if (context.estimatedTokens + tokens <= maxTokens) {
        context.referencedTypes.push(typeDef);
        context.estimatedTokens += tokens;
      }
    }
  }

  // Priority 4: Relevant imports
  for (const imp of fileAnalysis.imports) {
    const hasRelevantSpecifier = imp.specifiers.some(
      (s) => allCalls.has(s) || allReferences.has(s)
    );
    if (hasRelevantSpecifier || imp.isDefault) {
      const importStr = formatImport(imp);
      const tokens = estimateTokens(importStr);
      if (context.estimatedTokens + tokens <= maxTokens) {
        context.relevantImports.push(imp);
        context.estimatedTokens += tokens;
      }
    }
  }

  return context;
}

/**
 * Format optimized context as a string for LLM prompt
 */
export function formatContextForPrompt(context: OptimizedContext): string {
  const sections: string[] = [];

  // Imports
  if (context.relevantImports.length > 0) {
    sections.push('// Relevant imports');
    for (const imp of context.relevantImports) {
      sections.push(formatImport(imp));
    }
    sections.push('');
  }

  // Type definitions
  if (context.referencedTypes.length > 0) {
    sections.push('// Referenced types');
    for (const typeDef of context.referencedTypes) {
      sections.push(typeDef.code);
    }
    sections.push('');
  }

  // Callee signatures
  if (context.calleeSignatures.length > 0) {
    sections.push('// Function signatures (called by changed code)');
    for (const sig of context.calleeSignatures) {
      sections.push(sig);
    }
    sections.push('');
  }

  // Changed code (primary focus)
  if (context.changedUnits.length > 0) {
    sections.push('// === CHANGED CODE (analyze this) ===');
    for (const unit of context.changedUnits) {
      sections.push(`// ${unit.type}: ${unit.name} (lines ${unit.startLine}-${unit.endLine})`);
      sections.push(unit.code);
      sections.push('');
    }
  }

  return sections.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Extraction Helpers
// ─────────────────────────────────────────────────────────────

function extractFunction(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  content: string
): CodeUnit | null {
  if (!node.name) return null;

  const name = node.name.getText(sourceFile);
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const code = content.split('\n').slice(startLine - 1, endLine).join('\n');
  const hash = createHash('md5').update(code).digest('hex');

  // Build signature
  const signature = buildFunctionSignature(node, sourceFile);

  // Extract parameters
  const parameters = node.parameters.map((p) => extractParameter(p, sourceFile));

  // Get return type
  const returnType = node.type ? node.type.getText(sourceFile) : undefined;

  // Find function calls within this function
  const calls = findFunctionCalls(node, sourceFile);

  // Find type references
  const references = findTypeReferences(node, sourceFile);

  // Check if exported
  const exported = hasExportModifier(node);

  // Check if async
  const async = hasAsyncModifier(node);

  return {
    type: 'function',
    name,
    startLine,
    endLine,
    code,
    hash,
    signature,
    exported,
    async,
    parameters,
    returnType,
    calls,
    references,
  };
}

function extractArrowFunction(
  decl: ts.VariableDeclaration,
  statement: ts.VariableStatement,
  sourceFile: ts.SourceFile,
  content: string
): CodeUnit | null {
  if (!ts.isIdentifier(decl.name)) return null;

  const name = decl.name.getText(sourceFile);
  const startLine = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(statement.getEnd()).line + 1;
  const code = content.split('\n').slice(startLine - 1, endLine).join('\n');
  const hash = createHash('md5').update(code).digest('hex');

  const init = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;

  // Extract parameters
  const parameters = init.parameters.map((p) => extractParameter(p, sourceFile));

  // Get return type
  const returnType = init.type ? init.type.getText(sourceFile) : undefined;

  // Build signature
  const paramStr = parameters.map((p) => `${p.name}${p.optional ? '?' : ''}${p.type ? ': ' + p.type : ''}`).join(', ');
  const signature = `const ${name} = (${paramStr})${returnType ? ': ' + returnType : ''} => { ... }`;

  // Find function calls
  const calls = findFunctionCalls(init, sourceFile);

  // Find type references
  const references = findTypeReferences(init, sourceFile);

  // Check if exported
  const exported = hasExportModifier(statement);

  // Check if async
  const async = init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false;

  return {
    type: 'arrow-function',
    name,
    startLine,
    endLine,
    code,
    hash,
    signature,
    exported,
    async,
    parameters,
    returnType,
    calls,
    references,
  };
}

function extractMethod(
  node: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
  content: string,
  className: string
): CodeUnit | null {
  if (!node.name) return null;

  const name = node.name.getText(sourceFile);
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const code = content.split('\n').slice(startLine - 1, endLine).join('\n');
  const hash = createHash('md5').update(code).digest('hex');

  // Build signature
  const signature = buildMethodSignature(node, sourceFile, className);

  // Extract parameters
  const parameters = node.parameters.map((p) => extractParameter(p, sourceFile));

  // Get return type
  const returnType = node.type ? node.type.getText(sourceFile) : undefined;

  // Find function calls
  const calls = findFunctionCalls(node, sourceFile);

  // Find type references
  const references = findTypeReferences(node, sourceFile);

  // Check if async
  const async = hasAsyncModifier(node);

  return {
    type: 'method',
    name,
    startLine,
    endLine,
    code,
    hash,
    signature,
    className,
    exported: false, // Methods inherit export from class
    async,
    parameters,
    returnType,
    calls,
    references,
  };
}

function extractClass(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  content: string
): CodeUnit | null {
  if (!node.name) return null;

  const name = node.name.getText(sourceFile);
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const code = content.split('\n').slice(startLine - 1, endLine).join('\n');
  const hash = createHash('md5').update(code).digest('hex');

  // Build class signature (without method implementations)
  const signature = buildClassSignature(node, sourceFile);

  // Find type references in the class (extends, implements)
  const references: string[] = [];
  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      for (const type of clause.types) {
        references.push(type.expression.getText(sourceFile));
      }
    }
  }

  const exported = hasExportModifier(node);

  return {
    type: 'class',
    name,
    startLine,
    endLine,
    code,
    hash,
    signature,
    exported,
    async: false,
    parameters: [],
    calls: [],
    references,
  };
}

function extractTypeDefinition(
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
  sourceFile: ts.SourceFile,
  content: string
): TypeDefinition | null {
  const name = node.name.getText(sourceFile);
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const code = content.split('\n').slice(startLine - 1, endLine).join('\n');

  let kind: TypeDefinition['kind'];
  if (ts.isInterfaceDeclaration(node)) kind = 'interface';
  else if (ts.isTypeAliasDeclaration(node)) kind = 'type';
  else kind = 'enum';

  const exported = hasExportModifier(node);

  return { name, kind, startLine, endLine, code, exported };
}

function extractImport(node: ts.ImportDeclaration, sourceFile: ts.SourceFile): ImportInfo | null {
  const moduleSpecifier = node.moduleSpecifier;
  if (!ts.isStringLiteral(moduleSpecifier)) return null;

  const source = moduleSpecifier.text;
  const specifiers: string[] = [];
  let isDefault = false;
  let isNamespace = false;
  let isTypeOnly = false;
  let alias: string | undefined;

  if (node.importClause) {
    isTypeOnly = node.importClause.isTypeOnly || false;

    if (node.importClause.name) {
      isDefault = true;
      specifiers.push(node.importClause.name.getText(sourceFile));
    }

    if (node.importClause.namedBindings) {
      if (ts.isNamespaceImport(node.importClause.namedBindings)) {
        isNamespace = true;
        alias = node.importClause.namedBindings.name.getText(sourceFile);
      } else if (ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          specifiers.push(element.name.getText(sourceFile));
        }
      }
    }
  }

  return { source, specifiers, isDefault, isNamespace, isTypeOnly, alias };
}

function extractExports(node: ts.ExportDeclaration | ts.ExportAssignment, sourceFile: ts.SourceFile): string[] {
  const exports: string[] = [];

  if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      exports.push(element.name.getText(sourceFile));
    }
  }

  return exports;
}

function extractParameter(param: ts.ParameterDeclaration, sourceFile: ts.SourceFile): ParameterInfo {
  const name = param.name.getText(sourceFile);
  const type = param.type ? param.type.getText(sourceFile) : undefined;
  const optional = !!param.questionToken || !!param.initializer;
  const defaultValue = param.initializer ? param.initializer.getText(sourceFile) : undefined;

  return { name, type, optional, defaultValue };
}

// ─────────────────────────────────────────────────────────────
// Signature Builders
// ─────────────────────────────────────────────────────────────

function buildFunctionSignature(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile): string {
  const name = node.name?.getText(sourceFile) || 'anonymous';
  const params = node.parameters.map((p) => p.getText(sourceFile)).join(', ');
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
  const async = hasAsyncModifier(node) ? 'async ' : '';
  const exported = hasExportModifier(node) ? 'export ' : '';

  return `${exported}${async}function ${name}(${params})${returnType};`;
}

function buildMethodSignature(node: ts.MethodDeclaration, sourceFile: ts.SourceFile, className: string): string {
  const name = node.name.getText(sourceFile);
  const params = node.parameters.map((p) => p.getText(sourceFile)).join(', ');
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
  const async = hasAsyncModifier(node) ? 'async ' : '';

  return `${className}.${async}${name}(${params})${returnType};`;
}

function buildClassSignature(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string {
  const name = node.name?.getText(sourceFile) || 'anonymous';
  const exported = hasExportModifier(node) ? 'export ' : '';

  let heritage = '';
  if (node.heritageClauses) {
    heritage = ' ' + node.heritageClauses.map((c) => c.getText(sourceFile)).join(' ');
  }

  // Get method signatures
  const methods: string[] = [];
  for (const member of node.members) {
    if (ts.isMethodDeclaration(member) && member.name) {
      const methodName = member.name.getText(sourceFile);
      const params = member.parameters.map((p) => p.getText(sourceFile)).join(', ');
      const returnType = member.type ? `: ${member.type.getText(sourceFile)}` : '';
      methods.push(`  ${methodName}(${params})${returnType};`);
    }
  }

  return `${exported}class ${name}${heritage} {\n${methods.join('\n')}\n}`;
}

// ─────────────────────────────────────────────────────────────
// Analysis Helpers
// ─────────────────────────────────────────────────────────────

function findFunctionCalls(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const calls: string[] = [];

  function visit(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      if (ts.isIdentifier(expr)) {
        calls.push(expr.getText(sourceFile));
      } else if (ts.isPropertyAccessExpression(expr)) {
        // Handle this.method() or obj.method()
        calls.push(expr.name.getText(sourceFile));
      }
    }
    ts.forEachChild(n, visit);
  }

  visit(node);
  return [...new Set(calls)]; // Dedupe
}

function findTypeReferences(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const refs: string[] = [];

  function visit(n: ts.Node) {
    if (ts.isTypeReferenceNode(n)) {
      const typeName = n.typeName;
      if (ts.isIdentifier(typeName)) {
        refs.push(typeName.getText(sourceFile));
      }
    }
    ts.forEachChild(n, visit);
  }

  visit(node);
  return [...new Set(refs)]; // Dedupe
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false;
}

function hasAsyncModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false;
}

function formatImport(imp: ImportInfo): string {
  if (imp.isNamespace) {
    return `import * as ${imp.alias} from '${imp.source}';`;
  }

  const parts: string[] = [];
  if (imp.isDefault && imp.specifiers.length > 0) {
    parts.push(imp.specifiers[0]);
  }

  const namedSpecifiers = imp.isDefault ? imp.specifiers.slice(1) : imp.specifiers;
  if (namedSpecifiers.length > 0) {
    parts.push(`{ ${namedSpecifiers.join(', ')} }`);
  }

  const typeOnly = imp.isTypeOnly ? 'type ' : '';
  return `import ${typeOnly}${parts.join(', ')} from '${imp.source}';`;
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

// ─────────────────────────────────────────────────────────────
// Git Integration - Find Changed Lines
// ─────────────────────────────────────────────────────────────

/**
 * Parse git diff output to extract changed line numbers
 */
export function parseGitDiffLines(diffOutput: string): Map<string, number[]> {
  const changedLines = new Map<string, number[]>();
  let currentFile: string | null = null;

  const lines = diffOutput.split('\n');

  for (const line of lines) {
    // Match file header: +++ b/path/to/file.ts
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      changedLines.set(currentFile, []);
      continue;
    }

    // Match hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      const startLine = parseInt(hunkMatch[1], 10);
      const count = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;

      const fileLines = changedLines.get(currentFile)!;
      for (let i = 0; i < count; i++) {
        fileLines.push(startLine + i);
      }
    }
  }

  return changedLines;
}

/**
 * Get hash of a code unit for caching
 */
export function getUnitHash(unit: CodeUnit): string {
  return unit.hash;
}

/**
 * Check if a unit's hash matches a cached hash
 */
export function isUnitUnchanged(unit: CodeUnit, cachedHash: string): boolean {
  return unit.hash === cachedHash;
}
