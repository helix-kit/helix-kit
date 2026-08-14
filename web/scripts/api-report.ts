import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

const runEntry = (entry: Entry): { ok: boolean; warnings: number; reportPath: string } => {
  // Always a scratch directory: the committed artifact is the MDX page rendered
  // from this, published on the docs site, rather than an `etc/` folder in each
  // package that only ever existed to be diffed.
  const reportFolder = path.join(tempRoot, 'reports', path.basename(entry.packageDirectory));
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
    // Always "local": api-extractor writes its report unconditionally, and the
    // comparison that gates CI is done on the rendered MDX instead.
    localBuild: true,
    showVerboseMessages: false,
    messageCallback: (message) => {
      // Reported per entry below; silence api-extractor's own console output so
      // 90 entries do not bury the summary.
      message.handled = true;
    },
  });

  // Deliberately not `result.succeeded`: that is false whenever there is any
  // warning, and warnings here are informational (`ae-forgotten-export` and
  // friends). Only a genuine extraction error matters here; drift is detected
  // by comparing the rendered MDX.
  return {
    ok: result.errorCount === 0,
    warnings: result.warningCount,
    reportPath: path.join(reportFolder, entry.reportFileName),
  };
};

const docsApiRoot = path.join(workspaceRoot, 'apps', 'helix', 'content', 'docs', 'api');

/** The folder each package's pages live under, e.g. `pdf-report`. */
const docsFolderFor = (entry: Entry) => entry.packageName.replace('@helix-hq/', '');

const docsPageName = (entry: Entry) =>
  entry.reportFileName.replace(/\.api\.md$/, '').replace(/^index$/, 'index');

/**
 * Renders one api-extractor report as a docs page.
 *
 * The report is already a fenced TypeScript block wrapped in a heading and a
 * "do not edit" note; only the block is worth publishing, so the frontmatter and
 * the note are rebuilt for the site rather than passed through.
 */
const renderPage = (entry: Entry, report: string): string => {
  const specifier = `${entry.packageName}${entry.subpath === '.' ? '' : entry.subpath.slice(1)}`;
  // api-extractor writes CRLF; normalise before matching, and so the committed
  // pages are identical whatever platform generated them.
  const fenced = /```ts\n([\s\S]*?)```/.exec(report.replace(/\r\n/g, '\n'));
  const body = (fenced?.[1] ?? '').trim();
  if (body === '') {
    throw new Error(`could not extract an API surface from the report for ${specifier}`);
  }

  // Both quoted: YAML treats a leading `@` as a reserved indicator, so an
  // unquoted `@helix-hq/...` title fails to parse.
  return `---
title: '${entry.subpath === '.' ? entry.packageName : entry.subpath.replace(/^\.\//, '')}'
description: 'Public API of ${specifier}.'
---

The complete public surface of \`${specifier}\`, generated from the published type
declarations. Anything absent here is not part of the package's contract.

\`\`\`ts
${body}
\`\`\`
`;
};

const writeIfChanged = (file: string, contents: string, write: boolean): boolean => {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === contents) {
    return false;
  }
  if (write) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return true;
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
  const stale: string[] = [];
  let warnings = 0;
  const pagesByFolder = new Map<string, string[]>();

  for (const entry of entries) {
    try {
      const result = runEntry(entry);
      warnings += result.warnings;
      if (!result.ok) {
        failures.push(entry);
        continue;
      }

      const folder = docsFolderFor(entry);
      const page = docsPageName(entry);
      pagesByFolder.set(folder, [...(pagesByFolder.get(folder) ?? []), page]);

      const file = path.join(docsApiRoot, folder, `${page}.mdx`);
      const contents = renderPage(entry, readFileSync(result.reportPath, 'utf8'));
      if (writeIfChanged(file, contents, localBuild)) {
        stale.push(`${entry.packageName}${entry.subpath.slice(1)}`);
      }
    } catch (error) {
      // One unanalysable entry should not hide the state of the other 65.
      failures.push(entry);
      console.error(
        `  ${entry.packageName}${entry.subpath.slice(1)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // The nav is derived from these, so a package that gains an entry point shows
  // up on the site without anyone editing a navigation file.
  for (const [folder, pages] of [...pagesByFolder].sort(([a], [b]) => a.localeCompare(b))) {
    const meta = {
      title: `@helix-hq/${folder}`,
      pages: [...pages].sort((a, b) =>
        a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b),
      ),
    };
    if (
      writeIfChanged(
        path.join(docsApiRoot, folder, 'meta.json'),
        `${JSON.stringify(meta, null, 2)}\n`,
        localBuild,
      )
    ) {
      stale.push(`${folder}/meta.json`);
    }
  }

  const rootMeta = {
    title: 'API Reference',
    pages: [...pagesByFolder.keys()].sort(),
  };
  if (
    writeIfChanged(
      path.join(docsApiRoot, 'meta.json'),
      `${JSON.stringify(rootMeta, null, 2)}\n`,
      localBuild,
    )
  ) {
    stale.push('api/meta.json');
  }

  const verb = localBuild ? 'Wrote' : 'Checked';
  const packageCount = new Set(entries.map((entry) => entry.packageName)).size;
  console.log(
    `${verb} ${entries.length} API reference page(s) across ${packageCount} package(s)` +
      `${warnings === 0 ? '' : ` (${warnings} extractor warnings)`}.`,
  );
  // Say what is not covered rather than letting a silent skip read as coverage.
  for (const [entry, reason] of UNANALYSABLE_ENTRIES) {
    console.log(`  skipped ${entry} — ${reason}`);
  }

  rmSync(tempRoot, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} entry point(s) failed to extract:\n` +
        failures.map((entry) => `  ${entry.packageName}${entry.subpath.slice(1)}`).join('\n'),
    );
    process.exit(1);
  }

  if (!localBuild && stale.length > 0) {
    console.error(
      `\n${stale.length} API reference page(s) are out of date:\n` +
        stale.map((name) => `  ${name}`).join('\n') +
        '\n\nThe public API changed. Run `pnpm api:update`, review the diff — a removed or\n' +
        'changed line means a major bump — and commit the updated pages.',
    );
    process.exit(1);
  }
};

main();
