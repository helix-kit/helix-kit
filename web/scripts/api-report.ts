import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Extractor, ExtractorConfig, ExtractorLogLevel } from '@microsoft/api-extractor';

type ExportTarget = string | { import?: string; types?: string };

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  publishConfig?: { exports?: Record<string, ExportTarget> };
};

type Entry = {
  packageName: string;
  packageDirectory: string;
  subpath: string;
  declarationPath: string;
  reportFileName: string;
};

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(workspaceRoot, 'packages');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'helix-api-report-'));

/**
 * Entry points api-extractor cannot analyse, and why.
 *
 * Keep this empty wherever possible — an unreported entry is an entry whose
 * public API can change without anyone noticing.
 */
const UNANALYSABLE_ENTRIES = new Map<string, string>([
  [
    '@helix-hq/design-system./components/map',
    'api-extractor cannot follow the ambient `GeoJSON` global namespace, and map.tsx is ' +
      'vendored from mapcn upstream, so switching it to explicit `geojson` imports would ' +
      'create drift with a file that is deliberately kept in sync.',
  ],
]);

const readPackageJson = (directory: string): PackageJson | null => {
  const manifestPath = path.join(directory, 'package.json');
  if (!existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageJson;
};

/**
 * A report per published entry point, named after the subpath it documents:
 * `.` -> `index`, `./components/data-table` -> `components-data-table`.
 */
const reportNameForSubpath = (subpath: string): string => {
  const normalized = subpath.replace(/^\.\/?/, '');
  return `${normalized === '' ? 'index' : normalized.replace(/\//g, '-')}.api.md`;
};

/**
 * The packages that actually get released, taken from the Changesets config so
 * there is one source of truth for "what we publish" rather than a second list
 * to keep in step.
 */
const releasedPackageNames = (): Set<string> => {
  const config = JSON.parse(
    readFileSync(path.join(workspaceRoot, '.changeset', 'config.json'), 'utf8'),
  ) as { ignore?: string[] };
  const ignored = new Set(config.ignore ?? []);

  const names = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => readPackageJson(path.join(packagesRoot, dirent.name)))
    .filter((manifest): manifest is PackageJson => manifest != null && manifest.private !== true)
    .map((manifest) => manifest.name)
    .filter((name) => name.startsWith('@helix-hq/') && !ignored.has(name));

  return new Set(names);
};

/**
 * Only `publishConfig.exports` is walked: that is what an installed consumer
 * resolves, and it points at `dist`. The workspace `exports` point at source,
 * which is not what anybody outside this repo ever sees.
 */
const collectEntries = (): Entry[] => {
  const released = releasedPackageNames();
  const entries: Entry[] = [];

  for (const dirent of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const packageDirectory = path.join(packagesRoot, dirent.name);
    const manifest = readPackageJson(packageDirectory);
    const exportMap = manifest?.publishConfig?.exports;
    if (manifest == null || exportMap === undefined || !released.has(manifest.name)) {
      continue;
    }

    for (const [subpath, target] of Object.entries(exportMap)) {
      const types = typeof target === 'string' ? undefined : target.types;
      // String targets are assets (stylesheets, a postcss config) and entries
      // without `types` are untyped — neither has an API surface to report.
      if (types === undefined || !types.endsWith('.d.ts')) {
        continue;
      }
      if (UNANALYSABLE_ENTRIES.has(`${manifest.name}${subpath}`)) {
        continue;
      }

      entries.push({
        packageName: manifest.name,
        packageDirectory,
        subpath,
        declarationPath: path.join(packageDirectory, types),
        reportFileName: reportNameForSubpath(subpath),
      });
    }
  }

  return entries.sort((a, b) =>
    `${a.packageName}${a.subpath}`.localeCompare(`${b.packageName}${b.subpath}`),
  );
};

const runEntry = (entry: Entry, localBuild: boolean): { ok: boolean; warnings: number } => {
  const reportFolder = path.join(entry.packageDirectory, 'etc');
  mkdirSync(reportFolder, { recursive: true });

  const config = ExtractorConfig.prepare({
    configObjectFullPath: undefined,
    packageJsonFullPath: path.join(entry.packageDirectory, 'package.json'),
    configObject: {
      projectFolder: entry.packageDirectory,
      mainEntryPointFilePath: entry.declarationPath,
      apiReport: {
        enabled: true,
        reportFolder,
        reportFileName: entry.reportFileName,
        // Otherwise api-extractor scatters `temp/` directories through the
        // packages to hold the report it compares against.
        reportTempFolder: path.join(tempRoot, path.basename(entry.packageDirectory)),
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      // Supplied inline rather than pointing at the package's tsconfig: only
      // `.d.ts` is being read, and api-extractor runs on its own bundled
      // TypeScript 5.9 (the repo's `typescript@7` is the native compiler and
      // exposes no compiler API at all).
      compiler: {
        skipLibCheck: true,
        overrideTsconfig: {
          compilerOptions: {
            target: 'esnext',
            module: 'esnext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            lib: ['esnext', 'dom', 'dom.iterable'],
            strict: true,
            skipLibCheck: true,
            // `types` is deliberately unset so every `@types/*` in scope loads.
            // Restricting it breaks entries that lean on ambient globals —
            // `Buffer` from @types/node, `GeoJSON` from @types/geojson — and an
            // unresolvable global aborts the whole analysis rather than
            // degrading it.
          },
          // The entry declaration is the only input; api-extractor walks the
          // graph from there.
          files: [entry.declarationPath],
        },
      },
      messages: {
        compilerMessageReporting: { default: { logLevel: ExtractorLogLevel.Warning } },
        extractorMessageReporting: {
          default: { logLevel: ExtractorLogLevel.Warning },
          // Release tags (@public/@beta/@alpha) are a staged-rollout mechanism
          // this project does not use: every exported symbol is public, so the
          // tag would be noise on every declaration.
          'ae-missing-release-tag': { logLevel: ExtractorLogLevel.None },
        },
        tsdocMessageReporting: { default: { logLevel: ExtractorLogLevel.None } },
      },
    },
  });

  const result = Extractor.invoke(config, {
    localBuild,
    showVerboseMessages: false,
    messageCallback: (message) => {
      // Reported per entry below; silence api-extractor's own console output so
      // 90 entries do not bury the summary.
      message.handled = true;
    },
  });

  // Deliberately not `result.succeeded`: that is false whenever there is any
  // warning, and warnings here are informational (`ae-forgotten-export` and
  // friends). What this gate cares about is whether the public API drifted from
  // the committed report, plus genuine extraction errors.
  const ok = result.errorCount === 0 && (localBuild || !result.apiReportChanged);
  return { ok, warnings: result.warningCount };
};

const main = () => {
  const localBuild = process.argv.includes('--update');
  const entries = collectEntries();

  if (entries.length === 0) {
    console.error('No published entry points found — run `pnpm build` first.');
    process.exit(1);
  }

  const missingBuild = entries.filter((entry) => !existsSync(entry.declarationPath));
  if (missingBuild.length > 0) {
    console.error(
      `Missing declarations for ${missingBuild.length} entry point(s) — run \`pnpm build\` first:\n` +
        missingBuild.map((entry) => `  ${entry.packageName}${entry.subpath.slice(1)}`).join('\n'),
    );
    process.exit(1);
  }

  const failures: Entry[] = [];
  let warnings = 0;
  for (const entry of entries) {
    try {
      const result = runEntry(entry, localBuild);
      warnings += result.warnings;
      if (!result.ok) {
        failures.push(entry);
      }
    } catch (error) {
      // One unanalysable entry should not hide the state of the other 90.
      failures.push(entry);
      console.error(
        `  ${entry.packageName}${entry.subpath.slice(1)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const verb = localBuild ? 'Wrote' : 'Checked';
  const packageCount = new Set(entries.map((entry) => entry.packageName)).size;
  console.log(
    `${verb} ${entries.length} API report(s) across ${packageCount} package(s)` +
      `${warnings === 0 ? '' : ` (${warnings} extractor warnings)`}.`,
  );
  // Say what is not covered rather than letting a silent skip read as coverage.
  for (const [entry, reason] of UNANALYSABLE_ENTRIES) {
    console.log(`  skipped ${entry} — ${reason}`);
  }

  rmSync(tempRoot, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} API report(s) are out of date or failed to generate:\n` +
        failures.map((entry) => `  ${entry.packageName}${entry.subpath.slice(1)}`).join('\n') +
        '\n\nThe public API changed. Run `pnpm api:update`, review the diff — a removed or\n' +
        'changed line means a major bump — and commit the updated reports.',
    );
    process.exit(1);
  }
};

main();
