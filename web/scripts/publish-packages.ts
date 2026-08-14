import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type PackageJson = { name: string; version: string; private?: boolean };

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(workspaceRoot, 'packages');

/**
 * Publishes each released package that is not already on the registry, and tags
 * it.
 *
 * This replaces `changeset publish`, which shells out to `pnpm publish` —
 * necessary, because pnpm is what rewrites the `workspace:^` protocol into real
 * ranges at pack time — but pnpm has no provenance support, so
 * `NPM_CONFIG_PROVENANCE` was silently ignored and the published tarballs
 * carried no attestation.
 *
 * Packing with pnpm and then publishing the tarball with npm gets both: the
 * workspace protocol is resolved in the tarball, and `npm publish --provenance`
 * signs it with a sigstore attestation tying it to the commit and workflow run.
 */
const releasedPackages = () => {
  const config = JSON.parse(
    readFileSync(path.join(workspaceRoot, '.changeset', 'config.json'), 'utf8'),
  ) as { ignore?: string[] };
  const ignored = new Set(config.ignore ?? []);

  return readdirSync(packagesRoot, { withFileTypes: true })
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
        !ignored.has(manifest.name),
    )
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
};

const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

const alreadyPublished = async (name: string, version: string) => {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (!response.ok) {
    return false; // never published at all
  }
  const document = (await response.json()) as { versions?: Record<string, unknown> };
  return Object.hasOwn(document.versions ?? {}, version);
};

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const packages = releasedPackages();
  const published: string[] = [];
  const skipped: string[] = [];

  for (const { directory, manifest } of packages) {
    const label = `${manifest.name}@${manifest.version}`;

    // Idempotent: a run retried after a partial failure must not die on the
    // packages that already made it.
    if (await alreadyPublished(manifest.name, manifest.version)) {
      skipped.push(label);
      console.log(`- ${label} already on the registry`);
      continue;
    }

    const staging = mkdtempSync(path.join(tmpdir(), 'helix-publish-'));
    try {
      run('pnpm', ['pack', '--pack-destination', staging], directory);
      const tarballName = readdirSync(staging).find((file) => file.endsWith('.tgz'));
      if (tarballName === undefined) {
        throw new Error(`pnpm pack produced no tarball for ${manifest.name}`);
      }

      if (dryRun) {
        console.log(`= ${label} would publish (${tarballName})`);
        skipped.push(label);
        continue;
      }

      const output = run(
        'npm',
        ['publish', path.join(staging, tarballName), '--provenance', '--access', 'public'],
        workspaceRoot,
      );
      console.log(`✓ ${label}`);
      if (!output.includes('Signed provenance statement')) {
        // Loud, because the whole point of publishing from CI is the attestation.
        console.warn(`  warning: no provenance statement reported for ${label}`);
      }

      // Same tag shape changesets used, so history stays continuous.
      run('git', ['tag', '-a', label, '-m', label], workspaceRoot);
      published.push(label);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  console.log(
    `\n${published.length} published, ${skipped.length} skipped, of ${packages.length} released package(s).`,
  );
  if (published.length > 0) {
    console.log(`Tagged: ${published.join(', ')}`);
  }
};

// Not top-level await: tsx transpiles these scripts to CJS, which cannot use it.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
