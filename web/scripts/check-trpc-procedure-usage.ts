import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// typescript@7 (native Go compiler) dropped the classic JS compiler API this
// analyzer needs, so we import the aliased classic line.
import ts from 'typescript-classic';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..');

interface IgnoredProcedure {
  path?: string;
  reason?: string;
}

interface ManualUsage {
  path?: string;
  reason?: string;
}

interface UsageConfig {
  ignoreProcedures: Array<string | IgnoredProcedure>;
  manualUsages: ManualUsage[];
  reportJsonPath: string;
  reportMarkdownPath: string;
  usageRoots: string[];
  rootScanRoots: string[];
  ignoreUsagePaths?: string[];
}

interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

interface OpenApiMeta {
  method: string;
  path: string;
}

interface ProcedureInfo {
  kind: string;
  openapi: OpenApiMeta | null;
  path: string;
  surface: string;
  definedAt: SourceLocation;
}

interface ProcedureUsage {
  kind: string;
  location: SourceLocation;
  reason?: string;
}

interface Diagnostic {
  level: string;
  message: string;
  location: SourceLocation;
}

type ReportRow = ProcedureInfo & {
  ignoreReason: string | null;
  status: string;
  usageCount: number;
  usages: ProcedureUsage[];
};

type ExportEntry =
  | { kind: 'local'; initializer: ts.Expression }
  | { kind: 'reexport'; file: string; exportName: string };

interface ModuleInfo {
  imports: Map<string, { file: string; exportName: string }>;
  exports: Map<string, ExportEntry>;
  starExportFiles: string[];
  sourceFile: ts.SourceFile;
}

interface RouterShape {
  file: string;
  node: ts.ObjectLiteralExpression;
}

type ExportTarget = string | { import?: string; types?: string };

interface PackageInfo {
  dir: string;
  name: string;
  exportsField: Record<string, ExportTarget>;
}

interface ResolvedIdentifier {
  file: string;
  expression: ts.Expression;
}

interface PendingRoot {
  file: string;
  node: ts.ObjectLiteralExpression;
  surface: string;
}

interface PendingRootExpression {
  file: string;
  expression: ts.Expression;
  surface: string;
}

const DEFAULT_CONFIG: UsageConfig = {
  ignoreProcedures: [],
  manualUsages: [],
  reportJsonPath: '../reports/trpc-procedure-usage.json',
  reportMarkdownPath: '../reports/trpc-procedure-usage.md',
  // Router mount points (createRootRouter, handler `router:` args, createCallerFactory)
  // are auto-discovered under these roots — no hand-maintained entrypoint list.
  rootScanRoots: ['apps'],
  usageRoots: ['apps', 'packages', '../tests/e2e', '../tooling', '../cloud'],
};

const PROCEDURE_TERMINALS = new Set([
  'query',
  'mutation',
  'subscription',
  'queryOptions',
  'mutationOptions',
  'subscriptionOptions',
  'useQuery',
  'useMutation',
  'useSuspenseQuery',
  'useInfiniteQuery',
  'useSuspenseInfiniteQuery',
  'fetch',
  'fetchInfinite',
  'prefetch',
  'prefetchInfinite',
  'ensureData',
  'invalidate',
  'refetch',
  'cancel',
  'setData',
  'setInfiniteData',
  'getData',
  'getInfiniteData',
  'queryFilter',
  'queryKey',
  'pathFilter',
  'mutate',
  'mutateAsync',
  'subscribe',
]);

const PROCEDURE_KINDS = new Set(['query', 'mutation', 'subscription']);
const HANDLER_CALL_NAMES = new Set(['fetchRequestHandler', 'createOpenApiHttpHandler']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TEXT_USAGE_EXTENSIONS = new Set([
  '.cjs',
  '.go',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.py',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const SKIPPED_DIRS = new Set([
  '.git',
  '.mypy_cache',
  '.next',
  '.pytest_cache',
  '.ruff_cache',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'venv',
]);
const MAX_RESOLUTION_DEPTH = 30;

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;

const readJsonIfExists = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

const normalizeRelativePath = (value: string): string => value.split(path.sep).join('/');

const resolveConfigPath = (args: string[]): string => {
  const configIndex = args.findIndex((arg) => arg === '--config');
  if (configIndex === -1) {
    return path.join(WEB_DIR, 'trpc-procedure-usage.config.json');
  }
  const configValue = args[configIndex + 1];
  if (configValue === undefined || configValue.startsWith('--')) {
    throw new Error('--config requires a JSON config path.');
  }
  return path.resolve(WEB_DIR, configValue);
};

const loadConfig = async (): Promise<UsageConfig> => ({
  ...DEFAULT_CONFIG,
  ...(await readJsonIfExists(resolveConfigPath(process.argv.slice(2)))),
});

const walkFiles = async (rootDir: string, extensions: Set<string>): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (currentDir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) {
          await walk(path.join(currentDir, entry.name));
        }
        continue;
      }

      if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        files.push(path.join(currentDir, entry.name));
      }
    }
  };

  await walk(rootDir);
  return files;
};

const createSourceFile = async (filePath: string): Promise<ts.SourceFile> => {
  const sourceText = await fs.readFile(filePath, 'utf8');
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
};

const getNodeLocation = (sourceFile: ts.SourceFile, node: ts.Node): SourceLocation => {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: normalizeRelativePath(path.relative(WEB_DIR, sourceFile.fileName)),
    line: position.line + 1,
    column: position.character + 1,
  };
};

const formatLocation = (location: SourceLocation): string =>
  `${location.file}:${location.line}:${location.column}`;

const getPropertyName = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const getExpressionChain = (expression: ts.Expression): string[] | null => {
  if (ts.isIdentifier(expression)) {
    return [expression.text];
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = getExpressionChain(expression.expression);
    return parent === null ? null : [...parent, expression.name.text];
  }
  if (ts.isCallExpression(expression)) {
    return getExpressionChain(expression.expression);
  }
  return null;
};

const getProcedureKind = (expression: ts.Expression): string | null => {
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const terminal = expression.expression.name.text;
    if (PROCEDURE_KINDS.has(terminal)) {
      return terminal;
    }
    return getProcedureKind(expression.expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return getProcedureKind(expression.expression);
  }
  return null;
};

const getStringProperty = (
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): string | null => {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || getPropertyName(property.name) !== propertyName) {
      continue;
    }
    if (
      ts.isStringLiteralLike(property.initializer) ||
      ts.isNoSubstitutionTemplateLiteral(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return null;
};

const getObjectProperty = (
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.ObjectLiteralExpression | null => {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || getPropertyName(property.name) !== propertyName) {
      continue;
    }
    return ts.isObjectLiteralExpression(property.initializer) ? property.initializer : null;
  }
  return null;
};

const getProperty = (
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | null => {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || getPropertyName(property.name) !== propertyName) {
      continue;
    }
    return property.initializer;
  }
  return null;
};

const getProcedureOpenApiMeta = (expression: ts.Expression): OpenApiMeta | null => {
  if (ts.isCallExpression(expression)) {
    const firstArg = expression.arguments[0];
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === 'meta' &&
      firstArg !== undefined &&
      ts.isObjectLiteralExpression(firstArg)
    ) {
      const openapi = getObjectProperty(firstArg, 'openapi');
      if (openapi !== null) {
        const method = getStringProperty(openapi, 'method');
        const openapiPath = getStringProperty(openapi, 'path');
        if (method !== null && openapiPath !== null) {
          return { method, path: openapiPath };
        }
      }
    }

    if (ts.isPropertyAccessExpression(expression.expression)) {
      return getProcedureOpenApiMeta(expression.expression.expression);
    }
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return getProcedureOpenApiMeta(expression.expression);
  }

  return null;
};

// Resolve a module specifier (relative, `@/*` alias, or `@helix-hq/*` package) to
// candidate absolute file paths.
const resolveImportPath = (
  fromFile: string,
  moduleSpecifier: string,
  packageIndex: Map<string, PackageInfo>,
): string[] | null => {
  if (moduleSpecifier.startsWith('.')) {
    const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
    return [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, 'index.ts'),
      path.join(basePath, 'index.tsx'),
    ];
  }

  if (moduleSpecifier.startsWith('@/')) {
    const appRoot = findAppRoot(fromFile);
    if (appRoot === null) {
      return null;
    }
    const basePath = path.join(appRoot, 'src', moduleSpecifier.slice('@/'.length));
    return [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, 'index.ts'),
      path.join(basePath, 'index.tsx'),
    ];
  }

  for (const packageInfo of packageIndex.values()) {
    const subpath = toPackageSubpath(packageInfo.name, moduleSpecifier);
    if (subpath === null) {
      continue;
    }
    const target = packageInfo.exportsField[subpath];
    const sourcePath = typeof target === 'string' ? target : (target?.import ?? target?.types);
    if (typeof sourcePath !== 'string') {
      return null;
    }
    return [path.join(packageInfo.dir, sourcePath)];
  }

  return null;
};

const toPackageSubpath = (packageName: string, specifier: string): string | null => {
  if (specifier === packageName) {
    return '.';
  }
  if (!specifier.startsWith(`${packageName}/`)) {
    return null;
  }
  return `./${specifier.slice(packageName.length + 1)}`;
};

// App root = parent of the nearest ancestor `src/`, so `@/*` aliases resolve
// without parsing each app's tsconfig paths.
const findAppRoot = (fromFile: string): string | null => {
  let currentDir = path.dirname(fromFile);
  let parentDir = path.dirname(currentDir);
  while (currentDir !== parentDir) {
    if (path.basename(currentDir) === 'src') {
      return parentDir;
    }
    currentDir = parentDir;
    parentDir = path.dirname(currentDir);
  }
  return null;
};

const findExistingFile = async (candidates: string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        throw error;
      }
    }
  }
  return null;
};

// Index every `@helix-hq/*` package's `exports` map so bare-specifier imports
// resolve to source files.
const buildPackageIndex = async (): Promise<Map<string, PackageInfo>> => {
  const index = new Map<string, PackageInfo>();
  for (const packagesRoot of ['packages']) {
    const rootDir = path.join(WEB_DIR, packagesRoot);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageDir = path.join(rootDir, entry.name);
      const packageJsonPath = path.join(packageDir, 'package.json');
      const packageJson = await readJsonIfExists(packageJsonPath);
      if (typeof packageJson.name !== 'string' || typeof packageJson.exports !== 'object') {
        continue;
      }
      index.set(packageJson.name, {
        dir: packageDir,
        name: packageJson.name,
        exportsField: packageJson.exports as Record<string, ExportTarget>,
      });
    }
  }
  return index;
};

class RouterAnalyzer {
  private readonly config: UsageConfig;
  private readonly packageIndex: Map<string, PackageInfo>;
  private readonly sourceFiles = new Map<string, ts.SourceFile>();
  private readonly moduleInfo = new Map<string, ModuleInfo>();
  private readonly procedures = new Map<string, ProcedureInfo>();
  private readonly diagnostics: Diagnostic[] = [];
  private pendingRoots: PendingRoot[] = [];
  private pendingRootExpressions: PendingRootExpression[] = [];

  constructor(config: UsageConfig, packageIndex: Map<string, PackageInfo>) {
    this.config = config;
    this.packageIndex = packageIndex;
  }

  async getSourceFile(filePath: string): Promise<ts.SourceFile> {
    const resolvedPath = path.resolve(filePath);
    const cached = this.sourceFiles.get(resolvedPath);
    if (cached !== undefined) {
      return cached;
    }
    const sourceFile = await createSourceFile(resolvedPath);
    this.sourceFiles.set(resolvedPath, sourceFile);
    return sourceFile;
  }

  async getModuleInfo(filePath: string): Promise<ModuleInfo> {
    const resolvedPath = path.resolve(filePath);
    const cached = this.moduleInfo.get(resolvedPath);
    if (cached !== undefined) {
      return cached;
    }

    const sourceFile = await this.getSourceFile(resolvedPath);
    const info: ModuleInfo = {
      imports: new Map(),
      exports: new Map(),
      starExportFiles: [],
      sourceFile,
    };
    this.moduleInfo.set(resolvedPath, info);

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const importClause = statement.importClause;
        if (
          importClause?.namedBindings !== undefined &&
          ts.isNamedImports(importClause.namedBindings)
        ) {
          const importedFile = await findExistingFile(
            resolveImportPath(resolvedPath, statement.moduleSpecifier.text, this.packageIndex) ??
              [],
          );
          if (importedFile !== null) {
            for (const element of importClause.namedBindings.elements) {
              info.imports.set(element.name.text, {
                file: importedFile,
                exportName: element.propertyName?.text ?? element.name.text,
              });
            }
          }
        }
      }

      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
        if (!ts.isStringLiteral(statement.moduleSpecifier)) {
          continue;
        }
        const referencedFile = await findExistingFile(
          resolveImportPath(resolvedPath, statement.moduleSpecifier.text, this.packageIndex) ?? [],
        );
        if (referencedFile === null) {
          continue;
        }
        if (statement.exportClause === undefined) {
          info.starExportFiles.push(referencedFile);
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            if (element.isTypeOnly) {
              continue;
            }
            info.exports.set(element.name.text, {
              kind: 'reexport',
              file: referencedFile,
              exportName: element.propertyName?.text ?? element.name.text,
            });
          }
        }
      }

      if (ts.isVariableStatement(statement)) {
        const isExported = statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );
        if (isExported !== true) {
          continue;
        }
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
            info.exports.set(declaration.name.text, {
              kind: 'local',
              initializer: declaration.initializer,
            });
          }
        }
      }
    }

    return info;
  }

  // Follow local exports and re-export chains to the expression that initializes `name`.
  async resolveExport(file: string, name: string, depth = 0): Promise<ResolvedIdentifier | null> {
    if (depth > MAX_RESOLUTION_DEPTH) {
      return null;
    }
    const moduleInfo = await this.getModuleInfo(file);
    const entry = moduleInfo.exports.get(name);
    if (entry !== undefined) {
      if (entry.kind === 'local') {
        return { file, expression: entry.initializer };
      }
      return this.resolveExport(entry.file, entry.exportName, depth + 1);
    }
    for (const starFile of moduleInfo.starExportFiles) {
      const resolved = await this.resolveExport(starFile, name, depth + 1);
      if (resolved !== null) {
        return resolved;
      }
    }
    return null;
  }

  // Resolve an identifier in `file` to its defining expression, imported or local.
  async resolveIdentifier(file: string, name: string): Promise<ResolvedIdentifier | null> {
    const moduleInfo = await this.getModuleInfo(file);
    const imported = moduleInfo.imports.get(name);
    if (imported !== undefined) {
      return this.resolveExport(imported.file, imported.exportName);
    }
    const exported = await this.resolveExport(file, name);
    if (exported !== null) {
      return exported;
    }
    // Fall back to a function-scoped `const name = ...` (e.g. an inline, never-exported router).
    return this.findLocalDeclaration(file, name);
  }

  async findLocalDeclaration(file: string, name: string): Promise<ResolvedIdentifier | null> {
    const sourceFile = await this.getSourceFile(file);
    let found: ResolvedIdentifier | null = null;

    const visit = (node: ts.Node): void => {
      if (found !== null) {
        return;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer !== undefined
      ) {
        found = { file, expression: node.initializer };
        return;
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return found;
  }

  // Unwrap an expression down to the `t.router({...})` shape object it produces,
  // following identifiers, factory currying, and function bodies.
  async resolveRouterShape(
    file: string,
    expression: ts.Expression,
    depth = 0,
  ): Promise<RouterShape | null> {
    if (depth > MAX_RESOLUTION_DEPTH) {
      this.diagnostics.push({
        level: 'warning',
        message: 'Router resolution exceeded max depth; likely a cycle.',
        location: getNodeLocation(await this.getSourceFile(file), expression),
      });
      return null;
    }

    if (ts.isParenthesizedExpression(expression)) {
      return this.resolveRouterShape(file, expression.expression, depth + 1);
    }

    if (ts.isObjectLiteralExpression(expression)) {
      return { file, node: expression };
    }

    if (ts.isIdentifier(expression)) {
      const resolved = await this.resolveIdentifier(file, expression.text);
      if (resolved === null) {
        this.diagnostics.push({
          level: 'warning',
          message: `Could not resolve identifier "${expression.text}" to a router definition.`,
          location: getNodeLocation(await this.getSourceFile(file), expression),
        });
        return null;
      }
      return this.resolveRouterShape(resolved.file, resolved.expression, depth + 1);
    }

    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      const { body } = expression;
      if (body === undefined) {
        return null;
      }
      if (ts.isBlock(body)) {
        const returnStatement = body.statements.find(
          (statement) => ts.isReturnStatement(statement) && statement.expression !== undefined,
        );
        if (returnStatement === undefined || !ts.isReturnStatement(returnStatement)) {
          this.diagnostics.push({
            level: 'warning',
            message: 'Router factory body has no return statement.',
            location: getNodeLocation(await this.getSourceFile(file), body),
          });
          return null;
        }
        return this.resolveRouterShape(
          file,
          returnStatement.expression as ts.Expression,
          depth + 1,
        );
      }
      return this.resolveRouterShape(file, body, depth + 1);
    }

    if (ts.isCallExpression(expression)) {
      const { expression: callee } = expression;

      if (
        (ts.isIdentifier(callee) &&
          (callee.text === 'createRootRouter' || callee.text === 'router')) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'router')
      ) {
        const routerShape = expression.arguments[0];
        if (routerShape === undefined || !ts.isObjectLiteralExpression(routerShape)) {
          this.diagnostics.push({
            level: 'warning',
            message: 'Router call has no static object-literal argument.',
            location: getNodeLocation(await this.getSourceFile(file), expression),
          });
          return null;
        }
        return { file, node: routerShape };
      }

      // Curried factory call, e.g. createRouterFactory<Ctx>()((t) => ...).
      if (ts.isCallExpression(callee)) {
        const factoryArgument = expression.arguments[0];
        if (factoryArgument === undefined) {
          return null;
        }
        return this.resolveRouterShape(file, factoryArgument, depth + 1);
      }

      // Direct invocation of an already-fully-applied factory value: resolve the
      // callee and descend into what it evaluates to, ignoring call arguments.
      if (ts.isIdentifier(callee)) {
        const resolvedCallee = await this.resolveIdentifier(file, callee.text);
        if (resolvedCallee !== null) {
          return this.resolveRouterShape(resolvedCallee.file, resolvedCallee.expression, depth + 1);
        }
      }

      this.diagnostics.push({
        level: 'warning',
        message: 'Could not statically resolve router-producing call expression.',
        location: getNodeLocation(await this.getSourceFile(file), expression),
      });
      return null;
    }

    this.diagnostics.push({
      level: 'warning',
      message: `Could not resolve router expression of kind ${ts.SyntaxKind[expression.kind]}.`,
      location: getNodeLocation(await this.getSourceFile(file), expression),
    });
    return null;
  }

  // Walk a resolved router shape, recording procedure leaves and recursing into sub-routers.
  async walkRouterShape(
    file: string,
    shapeNode: ts.ObjectLiteralExpression,
    prefix: string[],
    surface: string,
  ): Promise<void> {
    for (const property of shapeNode.properties) {
      if (!ts.isPropertyAssignment(property)) {
        this.diagnostics.push({
          level: 'warning',
          message: 'Router contains non-property assignment; skipped.',
          location: getNodeLocation(await this.getSourceFile(file), property),
        });
        continue;
      }

      const key = getPropertyName(property.name);
      if (key === null) {
        this.diagnostics.push({
          level: 'warning',
          message: 'Router contains dynamic property name; skipped.',
          location: getNodeLocation(await this.getSourceFile(file), property.name),
        });
        continue;
      }

      const childPrefix = [...prefix, key];
      const kind = getProcedureKind(property.initializer);
      if (kind !== null) {
        const procedurePath = childPrefix.join('.');
        const definedAt = getNodeLocation(await this.getSourceFile(file), property.name);
        const procedureKey = formatLocation(definedAt);
        if (!this.procedures.has(procedureKey)) {
          this.procedures.set(procedureKey, {
            kind,
            openapi: getProcedureOpenApiMeta(property.initializer),
            path: procedurePath,
            surface,
            definedAt,
          });
        }
        continue;
      }

      const nestedShape = await this.resolveRouterShape(file, property.initializer);
      if (nestedShape !== null) {
        await this.walkRouterShape(nestedShape.file, nestedShape.node, childPrefix, surface);
      }
    }
  }

  // Discover every place a router tree is mounted/served/called and walk each one.
  discoverRootsInFile(sourceFile: ts.SourceFile): void {
    const file = sourceFile.fileName;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const { expression: callee } = node;

        if (ts.isIdentifier(callee) && callee.text === 'createRootRouter') {
          const routerShape = node.arguments[0];
          if (routerShape !== undefined && ts.isObjectLiteralExpression(routerShape)) {
            const surface = formatLocation(getNodeLocation(sourceFile, node));
            this.pendingRoots.push({ file, node: routerShape, surface });
          }
        } else if (ts.isIdentifier(callee) && HANDLER_CALL_NAMES.has(callee.text)) {
          const options = node.arguments[0];
          const routerOption =
            options !== undefined && ts.isObjectLiteralExpression(options)
              ? getProperty(options, 'router')
              : null;
          if (routerOption !== null) {
            const surface = formatLocation(getNodeLocation(sourceFile, node));
            this.pendingRootExpressions.push({ file, expression: routerOption, surface });
          }
        } else if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'createCallerFactory' &&
          node.arguments[0] !== undefined
        ) {
          const surface = formatLocation(getNodeLocation(sourceFile, node));
          this.pendingRootExpressions.push({
            file,
            expression: node.arguments[0],
            surface,
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  async analyze(
    files: string[],
  ): Promise<{ diagnostics: Diagnostic[]; procedures: ProcedureInfo[] }> {
    this.pendingRoots = [];
    this.pendingRootExpressions = [];

    for (const file of files) {
      const sourceFile = await this.getSourceFile(file);
      this.discoverRootsInFile(sourceFile);
    }

    for (const root of this.pendingRoots) {
      await this.walkRouterShape(root.file, root.node, [], root.surface);
    }
    for (const root of this.pendingRootExpressions) {
      const shape = await this.resolveRouterShape(root.file, root.expression);
      if (shape !== null) {
        await this.walkRouterShape(shape.file, shape.node, [], root.surface);
      }
    }

    return {
      diagnostics: this.diagnostics,
      procedures: [...this.procedures.values()].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    };
  }
}

const collectUsageFiles = async (config: UsageConfig): Promise<string[]> => {
  const roots = config.usageRoots.map((root) => path.resolve(WEB_DIR, root));
  const files = (
    await Promise.all(roots.map((root) => walkFiles(root, TEXT_USAGE_EXTENSIONS)))
  ).flat();
  const reportRoot = path.resolve(REPO_ROOT, 'reports');
  return files.filter((file) => {
    const relativePath = normalizeRelativePath(path.relative(WEB_DIR, file));
    if ((config.ignoreUsagePaths ?? []).some((pattern) => matchesPattern(relativePath, pattern))) {
      return false;
    }
    if (file.startsWith(reportRoot + path.sep)) {
      return false;
    }
    return !file.endsWith('.d.ts');
  });
};

const collectCallExpressionUsages = (
  sourceFile: ts.SourceFile,
  proceduresByPath: Map<string, boolean>,
  usagesByPath: Map<string, ProcedureUsage[]>,
): void => {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const chain = getExpressionChain(node.expression);
      const terminal = chain === null ? undefined : chain.at(-1);
      if (chain !== null && terminal !== undefined && PROCEDURE_TERMINALS.has(terminal)) {
        for (let startIndex = 1; startIndex < chain.length - 1; startIndex += 1) {
          const candidatePath = chain.slice(startIndex, -1).join('.');
          if (proceduresByPath.has(candidatePath)) {
            usagesByPath.get(candidatePath)?.push({
              kind: terminal,
              location: getNodeLocation(sourceFile, node.expression),
            });
            break;
          }
        }
      } else if (chain !== null && terminal !== undefined && proceduresByPath.has(terminal)) {
        // A root-level procedure invoked directly through a server caller has no
        // .query/.mutate suffix — it's just `caller.procedureName(...)`.
        usagesByPath.get(terminal)?.push({
          kind: 'direct-call',
          location: getNodeLocation(sourceFile, node.expression),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
};

const collectStringLiteralUsages = (
  sourceFile: ts.SourceFile,
  procedurePaths: string[],
  usagesByPath: Map<string, ProcedureUsage[]>,
): void => {
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      for (const procedurePath of procedurePaths) {
        if (text === procedurePath || text.includes(`/trpc/${procedurePath}`)) {
          usagesByPath.get(procedurePath)?.push({
            kind: 'string-literal',
            location: getNodeLocation(sourceFile, node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
};

const getOpenApiUsageTargets = (procedure: ProcedureInfo): string[] => {
  if (procedure.openapi === null) {
    return [];
  }
  return [
    procedure.openapi.path.startsWith('/') ? procedure.openapi.path : `/${procedure.openapi.path}`,
  ];
};

const collectOpenApiTextUsages = async (
  filePath: string,
  procedures: ProcedureInfo[],
  usagesByPath: Map<string, ProcedureUsage[]>,
): Promise<void> => {
  const text = await fs.readFile(filePath, 'utf8');
  const relativePath = normalizeRelativePath(path.relative(WEB_DIR, filePath));
  for (const procedure of procedures) {
    for (const target of getOpenApiUsageTargets(procedure)) {
      const index = text.indexOf(target);
      if (index === -1) {
        continue;
      }
      const prefix = text.slice(0, index);
      const line = prefix.split('\n').length;
      const lastNewlineIndex = prefix.lastIndexOf('\n');
      usagesByPath.get(procedure.path)?.push({
        kind: 'openapi-path',
        location: {
          file: relativePath,
          line,
          column: index - lastNewlineIndex,
        },
      });
      break;
    }
  }
};

const wildcardToRegex = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
      .join('.*')}$`,
  );

const matchesPattern = (pathValue: string, pattern: string): boolean => {
  if (pattern.includes('*')) {
    return wildcardToRegex(pattern).test(pathValue);
  }
  return pathValue === pattern;
};

const getIgnoreReason = (procedurePath: string, config: UsageConfig): string | null => {
  for (const ignored of config.ignoreProcedures ?? []) {
    const pattern = typeof ignored === 'string' ? ignored : ignored.path;
    if (pattern !== undefined && matchesPattern(procedurePath, pattern)) {
      return typeof ignored === 'string'
        ? 'Configured ignore.'
        : (ignored.reason ?? 'Configured ignore.');
    }
  }
  return null;
};

const applyManualUsages = (
  config: UsageConfig,
  usagesByPath: Map<string, ProcedureUsage[]>,
): void => {
  for (const usage of config.manualUsages ?? []) {
    if (typeof usage.path !== 'string') {
      continue;
    }
    const usagePath = usage.path;
    const matchingPaths = [...usagesByPath.keys()].filter((procedurePath) =>
      matchesPattern(procedurePath, usagePath),
    );
    for (const procedurePath of matchingPaths) {
      usagesByPath.get(procedurePath)?.push({
        kind: 'manual',
        location: {
          file: 'trpc-procedure-usage.config.json',
          line: 1,
          column: 1,
        },
        reason: usage.reason ?? 'Configured manual usage.',
      });
    }
  }
};

const analyzeUsages = async (
  config: UsageConfig,
  procedures: ProcedureInfo[],
): Promise<Map<string, ProcedureUsage[]>> => {
  const procedurePaths = [...new Set(procedures.map((procedure) => procedure.path))];
  const proceduresByPath = new Map(procedurePaths.map((procedurePath) => [procedurePath, true]));
  const usagesByPath = new Map<string, ProcedureUsage[]>(
    procedurePaths.map((procedurePath) => [procedurePath, []]),
  );

  const files = await collectUsageFiles(config);
  for (const file of files) {
    if (SOURCE_EXTENSIONS.has(path.extname(file))) {
      const sourceFile = await createSourceFile(file);
      collectCallExpressionUsages(sourceFile, proceduresByPath, usagesByPath);
      collectStringLiteralUsages(sourceFile, procedurePaths, usagesByPath);
    }
    await collectOpenApiTextUsages(file, procedures, usagesByPath);
  }

  applyManualUsages(config, usagesByPath);
  return usagesByPath;
};

const makeReportRows = (
  config: UsageConfig,
  procedures: ProcedureInfo[],
  usagesByPath: Map<string, ProcedureUsage[]>,
): ReportRow[] =>
  procedures.map((procedure) => {
    const usages = usagesByPath.get(procedure.path) ?? [];
    const ignoreReason = getIgnoreReason(procedure.path, config);
    const status = usages.length > 0 ? 'used' : ignoreReason === null ? 'unused' : 'ignored';
    return {
      ...procedure,
      ignoreReason,
      status,
      usageCount: usages.length,
      usages,
    };
  });

const markdownEscape = (value: unknown): string =>
  String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');

const formatOpenApiRoute = (openapi: OpenApiMeta | null): string =>
  openapi === null ? '' : `${openapi.method.toUpperCase()} ${openapi.path}`;

const renderMarkdownReport = (rows: ReportRow[], diagnostics: Diagnostic[]): string => {
  const unusedRows = rows.filter((row) => row.status === 'unused');
  const ignoredRows = rows.filter((row) => row.status === 'ignored');
  const lines = [
    '# TRPC Procedure Usage',
    '',
    `Total procedures: ${rows.length}`,
    `Used procedures: ${rows.filter((row) => row.status === 'used').length}`,
    `Ignored procedures: ${ignoredRows.length}`,
    `Unused procedures: ${unusedRows.length}`,
    '',
  ];

  if (diagnostics.length > 0) {
    lines.push('## Analyzer Diagnostics', '');
    lines.push('| Level | Location | Message |');
    lines.push('| --- | --- | --- |');
    for (const diagnostic of diagnostics) {
      lines.push(
        `| ${markdownEscape(diagnostic.level)} | ${markdownEscape(formatLocation(diagnostic.location))} | ${markdownEscape(diagnostic.message)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Procedures', '');
  lines.push(
    '| Procedure | Kind | OpenAPI Route | Status | Uses | Root Surface | Defined At | Usage Locations |',
  );
  lines.push('| --- | --- | --- | --- | ---: | --- | --- | --- |');
  for (const row of rows) {
    const sortedUsages = [...row.usages].sort((left, right) =>
      formatLocation(left.location).localeCompare(formatLocation(right.location)),
    );
    const usageLocations =
      sortedUsages.length === 0
        ? (row.ignoreReason ?? '')
        : sortedUsages
            .map(
              (usage) =>
                `${formatLocation(usage.location)} (${usage.kind}${usage.reason ? `: ${usage.reason}` : ''})`,
            )
            .join('<br>');
    lines.push(
      `| ${markdownEscape(row.path)} | ${markdownEscape(row.kind)} | ${markdownEscape(formatOpenApiRoute(row.openapi))} | ${markdownEscape(row.status)} | ${row.usageCount} | ${markdownEscape(row.surface)} | ${markdownEscape(formatLocation(row.definedAt))} | ${markdownEscape(usageLocations)} |`,
    );
  }

  const openApiRows = rows.filter((row) =>
    row.usages.some((usage) => usage.kind === 'openapi-path'),
  );
  if (openApiRows.length > 0) {
    lines.push('', '## OpenAPI Usages', '');
    lines.push('| Procedure | OpenAPI Route | Direct HTTP Usage Locations |');
    lines.push('| --- | --- | --- |');
    for (const row of openApiRows) {
      const locations = row.usages
        .filter((usage) => usage.kind === 'openapi-path')
        .sort((left, right) =>
          formatLocation(left.location).localeCompare(formatLocation(right.location)),
        )
        .map((usage) => formatLocation(usage.location))
        .join('<br>');
      lines.push(
        `| ${markdownEscape(row.path)} | ${markdownEscape(formatOpenApiRoute(row.openapi))} | ${markdownEscape(locations)} |`,
      );
    }
  }

  if (unusedRows.length > 0) {
    lines.push('', '## Unused Procedures', '');
    for (const row of unusedRows) {
      lines.push(`- ${row.path} (${row.kind}) at ${formatLocation(row.definedAt)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
};

const writeReports = async (
  config: UsageConfig,
  rows: ReportRow[],
  diagnostics: Diagnostic[],
): Promise<void> => {
  const jsonPath = path.resolve(WEB_DIR, config.reportJsonPath);
  const markdownPath = path.resolve(WEB_DIR, config.reportMarkdownPath);
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });

  await fs.writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        diagnostics,
        procedures: rows,
        unusedProcedures: rows.filter((row) => row.status === 'unused'),
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(markdownPath, renderMarkdownReport(rows, diagnostics));
};

const main = async (): Promise<void> => {
  const config = await loadConfig();
  const packageIndex = await buildPackageIndex();
  const analyzer = new RouterAnalyzer(config, packageIndex);

  const rootScanFiles = (
    await Promise.all(
      config.rootScanRoots.map((root) => walkFiles(path.resolve(WEB_DIR, root), SOURCE_EXTENSIONS)),
    )
  ).flat();

  const { procedures, diagnostics } = await analyzer.analyze(rootScanFiles);
  const usagesByPath = await analyzeUsages(config, procedures);
  const rows = makeReportRows(config, procedures, usagesByPath);
  await writeReports(config, rows, diagnostics);

  const unusedRows = rows.filter((row) => row.status === 'unused');
  const reportUrl = pathToFileURL(path.resolve(WEB_DIR, config.reportMarkdownPath)).href;
  if (unusedRows.length > 0) {
    console.error(`Unused TRPC procedures (${unusedRows.length})`);
    for (const row of unusedRows) {
      console.error(`${row.path}  ${formatLocation(row.definedAt)}`);
    }
    console.error(`TRPC procedure usage report: ${reportUrl}`);
    process.exit(1);
  }

  console.log(`TRPC procedure usage clean (${rows.length} procedures). Report: ${reportUrl}`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
