'use strict';

// Emits a minimal runtime package.json containing only the packages a bundled
// service still imports at runtime (deps that the bundler kept external because
// of dynamic requires). Versions are pinned from the build's installed
// node_modules. Usage: node emit-runtime-package.cjs <bundle.js> <out.json>

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules, createRequire } = require('node:module');

const builtins = new Set(builtinModules);
const [bundleArg, outPath] = process.argv.slice(2);
if (bundleArg === undefined || outPath === undefined) {
  console.error('usage: emit-runtime-package.cjs <bundle.js> <out.json>');
  process.exit(1);
}
const bundlePath = path.resolve(bundleArg);

const code = fs.readFileSync(bundlePath, 'utf8');
const externals = new Set();

const addSpecifier = (name) => {
  if (name.startsWith('.') || name.startsWith('node:')) {
    return;
  }
  const top = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
  if (!builtins.has(top)) {
    externals.add(top);
  }
};

// CJS interop requires and dynamic imports can appear anywhere. The `(?<!\{)`
// skips JSDoc `@type {import('pkg')}` annotations (preceded by `{`).
for (const match of code.matchAll(/(?<!\{)(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  addSpecifier(match[1]);
}
// Static ESM import/export-from statements are hoisted to the top of the bundle;
// anchor to line start + the keyword so we don't match `from` inside code.
for (const match of code.matchAll(
  /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g,
)) {
  addSpecifier(match[1]);
}
// Side-effect-only imports: `import "pkg";`
for (const match of code.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
  addSpecifier(match[1]);
}

// Optional native add-ons that libraries (e.g. ws) load in a try/catch and
// work fine without; never install them into the slim runtime image.
const optionalNativeAddons = new Set(['bufferutil', 'utf-8-validate', 'pg-native']);

const requireFromBundle = createRequire(bundlePath);
const dependencies = {};
for (const name of [...externals].sort()) {
  if (optionalNativeAddons.has(name)) {
    continue;
  }
  let version = '*';
  try {
    version = requireFromBundle(`${name}/package.json`).version;
  } catch {
    // Transitive externals (e.g. cross-fetch, iconv-lite) aren't resolvable from
    // the bundle dir under pnpm; leave the version as "*" so npm picks latest.
  }
  dependencies[name] = version;
}

fs.writeFileSync(
  outPath,
  `${JSON.stringify({ name: 'runtime', private: true, type: 'module', dependencies }, null, 2)}\n`,
);
console.error('runtime externals:', dependencies);
