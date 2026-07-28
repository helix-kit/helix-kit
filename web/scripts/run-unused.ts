import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, '..');
const forwardedArgs = process.argv.slice(2);
const knipArgs = forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;

const run = (label: string, command: string, args: string[]): boolean => {
  const result = spawnSync(command, args, {
    cwd: WEB_DIR,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`\n✗ ${label} failed to start: ${result.error.message}`);
    return false;
  }

  return (result.status ?? 1) === 0;
};

// Run every step without exiting early so one failing check never short-circuits the rest; aggregate and fail at the end.
const steps: Array<[label: string, command: string, args: string[]]> = [
  ['exports:sync', 'pnpm', ['run', 'exports:sync']],
  ['trpc procedure usage', 'pnpm', ['exec', 'tsx', './scripts/check-trpc-procedure-usage.ts']],
  ['knip', 'pnpm', ['exec', 'knip', ...knipArgs]],
];

const failed: string[] = [];
for (const [label, command, args] of steps) {
  if (!run(label, command, args)) {
    failed.push(label);
  }
}

if (failed.length > 0) {
  console.error(`\n✗ unused check failed: ${failed.join(', ')}`);
  process.exit(1);
}
