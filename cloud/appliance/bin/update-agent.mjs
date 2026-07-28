#!/usr/bin/env node
// =============================================================================
// update-agent.mjs — the appliance's root self-upgrade daemon.
//
// The cloud app is unprivileged (user `helix`) and can't replace its own code
// or `systemctl restart` itself. This tiny daemon runs as ROOT, listens on
// 127.0.0.1:9787, and performs hot app-only upgrades on demand:
//
//   1. read the release manifest from the local cloud app's release API
//   2. for each app bundle: presign a download, fetch it, sha256-verify it
//   3. install-bundles.sh <zip>  (atomic `current` symlink swap, writes release.json)
//   4. re-run migrations (restart helix-bootstrap) then restart the app units
//
// Progress is streamed to a status file the cloud app reads back
// (appliance.upgradeProgress), so the Updates UI can poll across the app's own
// restart. Dependency-free: Node 24 stdlib only (global fetch, node:http, etc.).
//
// A *base image* upgrade (binaries/deps changed) is intentionally NOT handled
// here — the in-container agent can't replace its own base. Those are rejected
// up front (the cloud app surfaces the `docker pull` + recreate steps instead).
// =============================================================================
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BIND_HOST = process.env.HELIX_UPDATE_AGENT_HOST ?? '127.0.0.1';
const BIND_PORT = Number.parseInt(process.env.HELIX_UPDATE_AGENT_PORT ?? '9787', 10);
const AUTH_TOKEN = process.env.HELIX_UPDATE_AGENT_TOKEN?.trim() ?? '';
const CLOUD_API_BASE = (process.env.HELIX_CLOUD_API_BASE ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const RELEASE_TOKEN = process.env.HELIX_PACKAGE_RELEASE_TOKEN?.trim() ?? '';
const BASE_VERSION_FILE =
  process.env.HELIX_BASE_IMAGE_VERSION_PATH ?? '/opt/helix/BASE_IMAGE_VERSION';
const STATUS_FILE =
  process.env.HELIX_UPGRADE_STATUS_PATH ?? '/var/lib/helix/state/upgrade-status.json';
const STAGE_DIR = process.env.HELIX_BUNDLE_STAGE_DIR ?? '/opt/helix/bundles';
const INSTALL_SCRIPT = process.env.HELIX_INSTALL_BUNDLES ?? '/opt/helix/bin/install-bundles.sh';
// Overridable so the upgrade flow can be exercised off-appliance (no systemd).
const SYSTEMCTL = process.env.HELIX_SYSTEMCTL ?? 'systemctl';

// Which long-running systemd unit each app bundle backs. `helix-cloud-init`
// is migrations-only (re-run via the bootstrap oneshot), so it has no unit here.
const UNIT_FOR_APP = {
  'helix-cloud-app': 'helix-app',
  'helix-server': 'helix-server',
};

let busy = false;
let status = { phase: 'idle', version: null, steps: [], startedAt: null, finishedAt: null };

const persistStatus = async () => {
  try {
    await mkdir(join(STATUS_FILE, '..'), { recursive: true });
    await writeFile(`${STATUS_FILE}.tmp`, `${JSON.stringify(status, null, 2)}\n`);
    await rename(`${STATUS_FILE}.tmp`, STATUS_FILE);
  } catch (error) {
    console.error('update-agent: failed to persist status:', error.message);
  }
};

const setStep = async (name, state, detail) => {
  const existing = status.steps.find((s) => s.name === name);
  if (existing === undefined) {
    status.steps.push({ name, state, detail });
  } else {
    existing.state = state;
    existing.detail = detail;
  }
  console.log(`update-agent: [${state}] ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  await persistStatus();
};

const readBaseVersion = async () => {
  try {
    const parsed = Number.parseInt((await readFile(BASE_VERSION_FILE, 'utf8')).trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const cloudFetch = async (path, init = {}) => {
  const headers = { ...(init.headers ?? {}) };
  if (RELEASE_TOKEN !== '') {
    headers.authorization = `Bearer ${RELEASE_TOKEN}`;
  }
  const response = await fetch(`${CLOUD_API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}`);
  }
  return response;
};

const fetchManifest = async () => {
  const response = await cloudFetch('/api/external/storage/appliance-releases/manifest');
  const body = await response.json();
  return body.manifest ?? body;
};

const presignDownload = async (objectPath) => {
  const response = await cloudFetch('/api/external/storage/appliance-releases/download-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: objectPath }),
  });
  const body = await response.json();
  return body.request;
};

const sha256File = async (path) => {
  const hash = createHash('sha256');
  await pipeline((await import('node:fs')).createReadStream(path), hash);
  return hash.digest('hex');
};

const downloadBundle = async (appName, version, artifact, destDir) => {
  const request = await presignDownload(artifact.path);
  const response = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers: request.headers ?? {},
  });
  if (!response.ok || response.body === null) {
    throw new Error(`download ${appName} -> HTTP ${response.status}`);
  }
  // install-bundles.sh parses <name>-<version>.zip, so name the file that way.
  const dest = join(destDir, `${appName}-${version}.zip`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  const digest = await sha256File(dest);
  if (digest !== artifact.sha256) {
    throw new Error(`${appName} sha256 mismatch (expected ${artifact.sha256}, got ${digest})`);
  }
  return dest;
};

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });

const performUpgrade = async (version) => {
  busy = true;
  status = { phase: 'running', version, steps: [], startedAt: new Date().toISOString(), finishedAt: null };
  await persistStatus();
  const work = await mkdtemp(join(tmpdir(), 'helix-upgrade-'));
  try {
    await setStep('manifest', 'running');
    const manifest = await fetchManifest();
    const release = manifest.releases?.[version];
    if (release === undefined) {
      throw new Error(`release ${version} is not in the manifest`);
    }
    await setStep('manifest', 'done', `release ${version}`);

    await setStep('base-check', 'running');
    const baseVersion = await readBaseVersion();
    if ((release.minBaseImageVersion ?? 0) > baseVersion) {
      throw new Error(
        `release ${version} needs base image v${release.minBaseImageVersion}, running v${baseVersion} — pull ${release.combinedImage ?? 'the new image'} and recreate the container`,
      );
    }
    await setStep('base-check', 'done', `base v${baseVersion}`);

    // Download + verify every bundle into a clean temp dir BEFORE touching the
    // live tree, so a bad download aborts without a half-applied upgrade.
    const apps = Object.entries(release.apps ?? {});
    const staged = [];
    for (const [appName, artifact] of apps) {
      await setStep(`download:${appName}`, 'running');
      staged.push([appName, await downloadBundle(appName, version, artifact, work)]);
      await setStep(`download:${appName}`, 'done');
    }

    // Install (atomic symlink swap + release.json) then restart units.
    await mkdir(STAGE_DIR, { recursive: true });
    for (const [appName, zip] of staged) {
      await setStep(`install:${appName}`, 'running');
      const finalZip = join(STAGE_DIR, `${appName}-${version}.zip`);
      await rename(zip, finalZip).catch(async () => {
        await pipeline(
          (await import('node:fs')).createReadStream(zip),
          createWriteStream(finalZip),
        );
      });
      await run(INSTALL_SCRIPT, [finalZip]);
      await setStep(`install:${appName}`, 'done');
    }
    // Best-effort: hand the freshly-unpacked tree back to the app user. Never
    // fail the upgrade on it (off-appliance the user/dir may not exist).
    await run('/bin/sh', [
      '-c',
      `chown -R helix:helix ${join(STAGE_DIR, '..')}/apps 2>/dev/null || true`,
    ]);

    // Migrations first (the new cloud-init bundle ships them), then the services.
    if (release.apps?.['helix-cloud-init'] !== undefined) {
      await setStep('migrations', 'running');
      await run(SYSTEMCTL, ['restart', 'helix-bootstrap.service']);
      await setStep('migrations', 'done');
    }

    const units = apps
      .map(([appName]) => UNIT_FOR_APP[appName])
      .filter((unit) => unit !== undefined);
    for (const unit of units) {
      await setStep(`restart:${unit}`, 'running');
      // The app restarts itself last; once it's back, the UI re-reads this file.
      await run(SYSTEMCTL, ['restart', `${unit}.service`]);
      await setStep(`restart:${unit}`, 'done');
    }

    status.phase = 'done';
    status.finishedAt = new Date().toISOString();
    await persistStatus();
    console.log(`update-agent: upgrade to ${version} complete`);
  } catch (error) {
    status.phase = 'error';
    status.error = error.message;
    status.finishedAt = new Date().toISOString();
    await persistStatus();
    console.error(`update-agent: upgrade to ${version} FAILED — ${error.message}`);
  } finally {
    await rm(work, { recursive: true, force: true });
    busy = false;
  }
};

const readJsonBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve(null);
      }
    });
  });

const authorized = (req) => {
  if (AUTH_TOKEN === '') {
    return true;
  }
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${AUTH_TOKEN}`;
};

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    return send(res, 200, { ok: true, busy });
  }
  if (!authorized(req)) {
    return send(res, 401, { ok: false, message: 'unauthorized' });
  }
  if (req.method === 'GET' && req.url === '/status') {
    return send(res, 200, status);
  }
  if (req.method === 'POST' && req.url === '/upgrade') {
    const body = await readJsonBody(req);
    const version = body?.version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      return send(res, 400, { ok: false, message: 'a semver `version` is required' });
    }
    if (busy) {
      return send(res, 409, { ok: false, message: 'an upgrade is already running' });
    }
    void performUpgrade(version); // fire-and-forget; progress via /status + file
    return send(res, 202, { ok: true, accepted: true, version });
  }
  return send(res, 404, { ok: false, message: 'not found' });
});

server.listen(BIND_PORT, BIND_HOST, () => {
  console.log(`update-agent: listening on ${BIND_HOST}:${BIND_PORT} (cloud API ${CLOUD_API_BASE})`);
});
