import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ExportTarget = string | { types?: string; import?: string };

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  publishConfig?: { exports?: Record<string, ExportTarget> };
};

/**
 * Stylesheets and config files are legitimate export subpaths, but they are not
 * modules — attw reports them as unresolvable, which is noise rather than a
 * finding. Everything with real JS or types behind it stays checked.
 */
const nonModuleEntrypoints = (manifest: PackageJson): string[] =>
  Object.entries(manifest.publishConfig?.exports ?? {})
    // An entrypoint is only worth type-checking if it ships types. A stylesheet
    // or a bare `.mjs` config has none, so attw reports it unresolvable — noise,
    // not a finding.
    .filter(([, target]) => typeof target === 'string' || !target.types?.endsWith('.d.ts'))
    .map(([subpath]) => subpath);

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(workspaceRoot, 'packages');

/**
 * Both checks run against a real `pnpm pack` tarball rather than the source
 * tree, because every packaging bug this project has hit lived in the gap
 * between them: the workspace `exports` resolve to `src`, the published ones to
 * `dist`, and only the tarball exercises the second.
 */
const ignoredPackages = (): Set<string> => {
  const config = JSON.parse(
    readFileSync(path.join(workspaceRoot, '.changeset', 'config.json'), 'utf8'),
  ) as { ignore?: string[] };
  return new Set(config.ignore ?? []);
};

const findPublishablePackages = () =>
  readdirSync(packagesRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(packagesRoot, dirent.name))
    .filter((directory) => existsSync(path.join(directory, 'package.json')))
    .map((directory) => ({
      directory,
      manifest: JSON.parse(
        readFileSync(path.join(directory, 'package.json'), 'utf8'),
      ) as PackageJson,
    }))
    .filter(
      ({ manifest }) =>
        manifest.private !== true &&
        manifest.name.startsWith('@helix-hq/') &&
        // Same source of truth as the API reports: what Changesets releases.
        !ignoredPackages().has(manifest.name),
    )
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

const run = (command: string, args: string[], cwd: string) => {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' }),
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    return {
      ok: false,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` || failure.message,
    };
  }
};

const main = () => {
  const packages = findPublishablePackages();
  const failures: string[] = [];

  for (const { directory, manifest } of packages) {
    const staging = mkdtempSync(path.join(tmpdir(), 'helix-pack-'));
    try {
      const packed = run('pnpm', ['pack', '--pack-destination', staging], directory);
      if (!packed.ok) {
        failures.push(manifest.name);
        console.error(`✗ ${manifest.name} — pnpm pack failed\n${packed.output}`);
        continue;
      }

      const tarballName = readdirSync(staging).find((file) => file.endsWith('.tgz'));
      if (tarballName === undefined) {
        failures.push(manifest.name);
        console.error(`✗ ${manifest.name} — pnpm pack produced no tarball`);
        continue;
      }
      const tarball = path.join(staging, tarballName);

      // publint: manifest and file-layout correctness (exports pointing at
      // files that exist, module/type mismatches, missing entry points).
      const lint = run('pnpm', ['exec', 'publint', tarball], workspaceRoot);
      // attw: whether the shipped types actually resolve, under every module
      // resolution a consumer might use.
      const excluded = nonModuleEntrypoints(manifest);
      const types = run(
        'pnpm',
        [
          'exec',
          'attw',
          tarball,
          '--profile',
          'esm-only',
          '--format',
          'table-flipped',
          ...(excluded.length > 0 ? ['--exclude-entrypoints', ...excluded] : []),
        ],
        workspaceRoot,
      );

      if (lint.ok && types.ok) {
        console.log(`✓ ${manifest.name}@${manifest.version}`);
        continue;
      }

      failures.push(manifest.name);
      console.error(`✗ ${manifest.name}@${manifest.version}`);
      if (!lint.ok) {
        console.error(`  publint:\n${lint.output.trim()}`);
      }
      if (!types.ok) {
        console.error(`  are-the-types-wrong:\n${types.output.trim()}`);
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  console.log(`\nChecked ${packages.length} publishable package(s).`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} failed: ${failures.join(', ')}`);
    process.exit(1);
  }
};

main();
