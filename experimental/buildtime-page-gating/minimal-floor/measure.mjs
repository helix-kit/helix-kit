#!/usr/bin/env node
// measure.mjs — floor-min matrix. Builds runtime × profile and tabulates the
// static SPA output: raw + gzip JS, plus whether each heavy dep survives. Shows
// (a) how gating removes marginal feature weight and (b) how the React→Preact
// runtime swap collapses the framework floor.
//
// Usage:
//   node measure.mjs                                  # both runtimes, all profiles
//   node measure.mjs --runtimes preact --profiles minimal,full

import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const RESULTS = path.join(ROOT, 'results');

const DEP_SIGNATURES = {
  '@xyflow/react': ['react-flow__', 'xyflow'],
  recharts: ['recharts-', 'recharts'],
  'react-grid-layout': ['react-grid-layout', 'react-resizable'],
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runtimes') args.runtimes = argv[++i];
    else if (argv[i] === '--profiles') args.profiles = argv[++i];
  }
  return args;
}

function walk(dir, filter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter));
    else if (!filter || filter(p)) out.push(p);
  }
  return out;
}

function measureDist() {
  const js = walk(DIST, (f) => f.endsWith('.js'));
  let raw = 0;
  let gz = 0;
  const blobs = [];
  for (const f of js) {
    const buf = fs.readFileSync(f);
    raw += buf.length;
    gz += gzipSync(buf).length;
    blobs.push(buf.toString('utf8'));
  }
  const blob = blobs.join('\n');
  const deps = {};
  for (const [dep, sigs] of Object.entries(DEP_SIGNATURES)) deps[dep] = sigs.some((s) => blob.includes(s));
  return { rawBytes: raw, gzBytes: gz, jsFiles: js.length, deps };
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtimes = args.runtimes ? args.runtimes.split(',') : ['react', 'preact'];
  const profiles = args.profiles
    ? args.profiles.split(',')
    : Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'profiles.json'), 'utf8')));

  const rows = [];
  for (const runtime of runtimes) {
    for (const profile of profiles) {
      console.log(`\n===== runtime=${runtime} profile=${profile} =====`);
      const res = spawnSync('node', ['gate.mjs', '--profile', profile, '--runtime', runtime, '--build'], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      if (res.status !== 0) {
        console.error(`build failed: runtime=${runtime} profile=${profile}`);
        process.exit(1);
      }
      rows.push({ runtime, profile, ...measureDist() });
    }
  }

  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'matrix.json'), JSON.stringify(rows, null, 2));

  const depCols = ['xyflow', 'recharts', 'grid'];
  const header = ['runtime', 'profile', 'raw JS', 'gzip JS', 'files', ...depCols];
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
  const depKeys = Object.keys(DEP_SIGNATURES);
  for (const r of rows) {
    lines.push(
      [
        r.runtime,
        r.profile,
        kb(r.rawBytes),
        kb(r.gzBytes),
        String(r.jsFiles),
        ...depKeys.map((d) => (r.deps[d] ? 'IN' : '—')),
      ].join(' | '),
    );
  }
  const table = lines.join('\n');
  fs.writeFileSync(path.join(RESULTS, 'summary.md'), `# Floor-min matrix\n\n${table}\n`);
  console.log(`\n\n===== RESULTS =====\n\n${table}\n\nWrote results/matrix.json and results/summary.md`);
}

main();
