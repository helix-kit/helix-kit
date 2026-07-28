#!/usr/bin/env node
// Build a matrix of profiles through gate.mjs and tabulate output size + whether each heavy dep's signature survives.
// Usage:
//   node measure.mjs                       # all profiles, filesystem approach
//   node measure.mjs --approach stubbing
//   node measure.mjs --profiles full,minimal,workflow-only

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
const OUT = path.join(APP, 'out');
const RESULTS = path.join(ROOT, 'results');

// Signature strings each heavy dep leaves in client JS; CSS prefixes/runtime tokens survive minification, unlike renamed identifiers.
const DEP_SIGNATURES = {
  '@xyflow/react': ['react-flow__', 'xyflow'],
  recharts: ['recharts-', 'recharts'],
  'react-grid-layout': ['react-grid-layout', 'react-resizable'],
};

function parseArgs(argv) {
  const args = { approach: 'filesystem' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--approach') args.approach = argv[++i];
    else if (argv[i] === '--profiles') args.profiles = argv[++i];
  }
  return args;
}

function walk(dir, filter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, filter));
    else if (!filter || filter(p)) out.push(p);
  }
  return out;
}

function bytes(files) {
  return files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
}

function measureOut() {
  const all = walk(OUT);
  const js = all.filter((f) => f.endsWith('.js'));
  const jsBlob = js.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const deps = {};
  for (const [dep, sigs] of Object.entries(DEP_SIGNATURES)) {
    deps[dep] = sigs.some((s) => jsBlob.includes(s));
  }
  return { totalBytes: bytes(all), jsBytes: bytes(js), jsChunks: js.length, deps };
}

function fmt(n) {
  return (n / 1024).toFixed(0) + ' KB';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profiles = args.profiles
    ? args.profiles.split(',')
    : Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles.json'), 'utf8')));

  const rows = [];
  for (const profile of profiles) {
    console.log(`\n===== building profile=${profile} approach=${args.approach} =====`);
    const res = spawnSync(
      'node',
      ['gate.mjs', '--profile', profile, '--approach', args.approach, '--build'],
      { cwd: ROOT, stdio: 'inherit' },
    );
    if (res.status !== 0) {
      console.error(`build failed for profile ${profile}`);
      process.exit(1);
    }
    rows.push({ profile, approach: args.approach, ...measureOut() });
  }

  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `matrix-${args.approach}.json`), JSON.stringify(rows, null, 2));

  const depNames = Object.keys(DEP_SIGNATURES);
  const header = ['profile', 'total', 'client JS', 'chunks', ...depNames.map((d) => d.replace('@xyflow/react', 'xyflow').replace('react-grid-layout', 'grid'))];
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
  for (const r of rows) {
    lines.push(
      [
        r.profile,
        fmt(r.totalBytes),
        fmt(r.jsBytes),
        String(r.jsChunks),
        ...depNames.map((d) => (r.deps[d] ? 'IN' : '—')),
      ].join(' | '),
    );
  }
  const table = lines.join('\n');
  fs.writeFileSync(path.join(RESULTS, `summary-${args.approach}.md`), `# Gating matrix (${args.approach})\n\n${table}\n`);
  console.log(`\n\n===== RESULTS (approach=${args.approach}) =====\n`);
  console.log(table);
  console.log(`\nWrote results/matrix-${args.approach}.json and results/summary-${args.approach}.md`);
}

main();
