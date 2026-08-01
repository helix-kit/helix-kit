import { Dirent, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ExportTarget =
  | string
  | {
      import?: string;
      types?: string;
    };

type PackageJson = {
  name: string;
  exports?: Record<string, ExportTarget>;
  publishConfig?: {
    access?: string;
    exports?: Record<string, ExportTarget>;
  };
};

type TargetPackage = {
  directory: string;
  name: string;
};

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const TARGET_ROOTS = ['packages'] as const;
const SCAN_ROOTS = ['apps', 'packages'] as const;
const SYNC_ENABLED_PACKAGES = new Set([
  '@helix/backend',
  '@helix/design-system',
  '@helix/logger',
  '@helix/protocol',
]);
const SCAN_EXTENSIONS = new Set([
  '.css',
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);
// Public SDK subpaths with no in-repo importer; specifier-scanning alone would drop these on `--write`.
const ALWAYS_INCLUDE_EXPORTS: Record<string, string[]> = {
  '@helix/backend': [
    './events',
    './gateway/mqtt-bridge',
    './gateway/router',
    './pki/router',
    './pki/step-ca',
    './storage/azure-provider',
    './storage/filesystem-provider',
    './storage/filesystem-http',
    './storage/filesystem-shared',
    './storage/object-keys',
    './storage/s3-compatible-provider',
  ],
  '@helix/design-system': [
    './components/accordion',
    './components/alert-dialog',
    './components/app-header',
    './components/breadcrumb',
    './components/collapsible',
    './components/command',
    './components/dynamic-form-fields',
    './components/map',
    './components/native-select',
    './components/responsive-modal',
    './components/scroll-area',
    './components/select',
    './components/slider',
    './components/spinner',
    './components/toggle-group',
    './globals.css',
    './postcss.config',
  ],
  '@helix/protocol': ['./mqtt', './websocket'],
};
const FORCED_SOURCE_PATHS: Record<string, Record<string, string>> = {
  '@helix/design-system': {
    './globals.css': './src/styles/globals.css',
  },
};
const ROOT_FILE_CANDIDATE_EXTENSIONS = [
  '.css',
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
];
const SOURCE_FILE_CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const IMPORT_SPECIFIER_PATTERNS = [
  /\bimport\s*(?:type\s*)?(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g,
  /\bexport\s+(?:[^'"]*?\sfrom\s*)["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /@import\s+["']([^"']+)["']/g,
];

const sortObject = <T>(value: Record<string, T>) =>
  Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));

const getPackageJsonPath = (directory: string) => path.join(ROOT_DIR, directory, 'package.json');

const readPackageJson = (directory: string) =>
  JSON.parse(readFileSync(getPackageJsonPath(directory), 'utf8')) as PackageJson;

const listTargetPackages = () =>
  TARGET_ROOTS.flatMap((targetRoot) =>
    readdirSync(path.join(ROOT_DIR, targetRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${targetRoot}/${entry.name}`)
      .filter((directory) => existsSync(getPackageJsonPath(directory)))
      .map((directory) => {
        const packageJson = readPackageJson(directory);
        return {
          directory,
          name: packageJson.name,
        } satisfies TargetPackage;
      })
      .filter((targetPackage) => SYNC_ENABLED_PACKAGES.has(targetPackage.name)),
  );

const shouldSkipEntry = (entry: Dirent) =>
  entry.name === '.git' ||
  entry.name === '.next' ||
  entry.name === 'build' ||
  entry.name === 'coverage' ||
  entry.name === 'dist' ||
  entry.name === 'node_modules';

const collectFiles = (rootDirectory: string): string[] => {
  const result: string[] = [];
  const stack = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (currentDirectory === undefined) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!shouldSkipEntry(entry)) {
          stack.push(path.join(currentDirectory, entry.name));
        }
        continue;
      }

      const extension = path.extname(entry.name);
      if (SCAN_EXTENSIONS.has(extension)) {
        result.push(path.join(currentDirectory, entry.name));
      }
    }
  }

  return result.sort();
};

const collectImportSpecifiers = () => {
  const specifiers = new Set<string>();

  for (const scanRoot of SCAN_ROOTS) {
    for (const filePath of collectFiles(path.join(ROOT_DIR, scanRoot))) {
      const source = readFileSync(filePath, 'utf8');

      for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
        pattern.lastIndex = 0;

        for (const match of source.matchAll(pattern)) {
          const specifier = match[1]?.trim();
          if (specifier !== undefined && specifier !== '') {
            specifiers.add(specifier);
          }
        }
      }
    }
  }

  return [...specifiers].sort();
};

const toSubpath = (packageName: string, specifier: string) => {
  if (specifier === packageName) {
    return '.';
  }

  if (!specifier.startsWith(`${packageName}/`)) {
    return null;
  }

  return `./${specifier.slice(packageName.length + 1)}`;
};

const findExistingPath = (directory: string, candidates: string[]) => {
  for (const candidate of candidates) {
    const absolutePath = path.join(ROOT_DIR, directory, candidate);
    if (existsSync(absolutePath)) {
      return candidate.replaceAll(path.sep, '/');
    }
  }

  return null;
};

const resolveSubpathSource = (targetPackage: TargetPackage, subpath: string) => {
  const forcedSourcePath = FORCED_SOURCE_PATHS[targetPackage.name]?.[subpath];
  if (forcedSourcePath !== undefined) {
    return forcedSourcePath.replace(/^\.\//, '');
  }

  const { directory } = targetPackage;

  if (subpath === '.') {
    return findExistingPath(directory, [
      'src/index.ts',
      'src/index.tsx',
      'src/index.mts',
      'src/index.cts',
      'index.ts',
      'index.tsx',
      'index.mts',
      'index.cts',
      'index.js',
      'index.mjs',
      'index.cjs',
    ]);
  }

  const normalizedSubpath = subpath.replace(/^\.\//, '');
  const extension = path.extname(normalizedSubpath);

  if (extension === '.css') {
    const sourceCandidate = extension === '.css' ? `src/${normalizedSubpath}` : null;

    const candidates = [sourceCandidate, normalizedSubpath].filter(
      (candidate): candidate is string => candidate !== null,
    );

    return findExistingPath(directory, candidates);
  }

  if (ROOT_FILE_CANDIDATE_EXTENSIONS.includes(extension)) {
    return findExistingPath(directory, [normalizedSubpath]);
  }

  const sourceCandidates = SOURCE_FILE_CANDIDATE_EXTENSIONS.flatMap((candidateExtension) => [
    `src/${normalizedSubpath}${candidateExtension}`,
    `src/${normalizedSubpath}/index${candidateExtension}`,
  ]);
  const rootCandidates = ROOT_FILE_CANDIDATE_EXTENSIONS.map(
    (candidateExtension) => `${normalizedSubpath}${candidateExtension}`,
  );

  return findExistingPath(directory, [...sourceCandidates, ...rootCandidates]);
};

const createSourceExport = (sourcePath: string): ExportTarget => {
  if (/\.(?:css|cjs|js|mjs)$/.test(sourcePath)) {
    return sourcePath;
  }

  return {
    import: sourcePath,
    types: sourcePath,
  };
};

const toPublishPath = (sourcePath: string) => {
  if (sourcePath === './postcss.config.mjs') {
    return sourcePath;
  }

  if (sourcePath.startsWith('./src/')) {
    const relativePath = sourcePath.slice('./src/'.length);

    if (relativePath.endsWith('.css')) {
      return `./dist/${relativePath}`;
    }

    if (/\.(?:[cm]?ts|tsx)$/.test(relativePath)) {
      const compiledBasePath = relativePath.replace(/\.(?:[cm]?ts|tsx)$/, '');
      return {
        import: `./dist/${compiledBasePath}.js`,
        types: `./dist/${compiledBasePath}.d.ts`,
      } satisfies ExportTarget;
    }
  }

  return sourcePath;
};

const createExportsForPackage = (
  targetPackage: TargetPackage,
  specifiers: readonly string[],
): {
  exports: Record<string, ExportTarget>;
  publishExports: Record<string, ExportTarget>;
} => {
  const packageSubpaths = new Set<string>(ALWAYS_INCLUDE_EXPORTS[targetPackage.name] ?? []);

  for (const specifier of specifiers) {
    const subpath = toSubpath(targetPackage.name, specifier);
    if (subpath !== null) {
      packageSubpaths.add(subpath);
    }
  }

  const exportsEntries: Record<string, ExportTarget> = {};
  const publishEntries: Record<string, ExportTarget> = {};

  for (const subpath of [...packageSubpaths].sort()) {
    const resolvedSourcePath = resolveSubpathSource(targetPackage, subpath);

    if (resolvedSourcePath === null) {
      throw new Error(
        `Unable to resolve export "${subpath}" for ${targetPackage.name} in ${targetPackage.directory}.`,
      );
    }

    const normalizedSourcePath = `./${resolvedSourcePath}`;
    exportsEntries[subpath] = createSourceExport(normalizedSourcePath);
    publishEntries[subpath] = toPublishPath(normalizedSourcePath);
  }

  return {
    exports: sortObject(exportsEntries),
    publishExports: sortObject(publishEntries),
  };
};

const writePackageJsonIfChanged = (
  targetPackage: TargetPackage,
  packageJson: PackageJson,
  exportsField: Record<string, ExportTarget>,
  publishExportsField: Record<string, ExportTarget>,
) => {
  const nextPackageJson: PackageJson = {
    ...packageJson,
    exports: exportsField,
    publishConfig: {
      ...packageJson.publishConfig,
      exports: publishExportsField,
    },
  };

  const nextContent = `${JSON.stringify(nextPackageJson, null, 2)}\n`;
  const packageJsonPath = getPackageJsonPath(targetPackage.directory);
  const currentContent = readFileSync(packageJsonPath, 'utf8');

  if (nextContent === currentContent) {
    return false;
  }

  if (WRITE) {
    writeFileSync(packageJsonPath, nextContent);
  }

  return true;
};

const main = () => {
  const specifiers = collectImportSpecifiers();
  const targetPackages = listTargetPackages();
  const changedPackages: string[] = [];

  for (const targetPackage of targetPackages) {
    const packageJson = readPackageJson(targetPackage.directory);
    const { exports, publishExports } = createExportsForPackage(targetPackage, specifiers);

    if (writePackageJsonIfChanged(targetPackage, packageJson, exports, publishExports)) {
      changedPackages.push(targetPackage.directory);
    }
  }

  if (!WRITE && changedPackages.length > 0) {
    console.error('Package exports out of sync:');
    for (const changedPackage of changedPackages) {
      console.error(`- ${changedPackage}`);
    }
    process.exitCode = 1;
    return;
  }

  if (WRITE) {
    if (changedPackages.length === 0) {
      console.log('Package exports already synced.');
      return;
    }

    console.log('Updated package exports:');
    for (const changedPackage of changedPackages) {
      console.log(`- ${changedPackage}`);
    }
  }
};

main();
