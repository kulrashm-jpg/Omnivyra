#!/usr/bin/env node
/**
 * Clean build artifacts: .next, dist, .vercel, plus local-only bloat.
 *
 * Safety rule:
 *   Cleanup is blocked whenever a live Next.js dev/build runtime is detected.
 *   Use --force only for an intentional manual override.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assertCleanupAllowed } = require('./dev-runtime-guard');

const root = process.cwd();
const dirs = ['.next', 'dist', '.vercel'];
const force = process.argv.includes('--force');
const triggerArg = process.argv.find((arg) => arg.startsWith('--trigger='));
const trigger = triggerArg ? triggerArg.slice('--trigger='.length) : process.env.npm_lifecycle_event || 'manual-clean';

async function cleanAll() {
  assertCleanupAllowed({ force, trigger });
  await Promise.all(
    dirs.map(async (dir) => {
      const target = path.join(root, dir);
      try {
        await fs.promises.rm(target, { recursive: true, force: true });
        console.log(`Cleared ${dir}/`);
      } catch (error) {
        console.warn(`Could not clear ${dir}/: ${error.message}`);
      }
    }),
  );

  const localBloat = path.join(root, 'scripts', 'clean-local-bloat.js');
  const result = spawnSync(process.execPath, [localBloat], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error('Local bloat cleanup failed');
  }
}

cleanAll()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error?.code !== 'UNSAFE_CLEANUP_BLOCKED') {
      console.error(error?.message || error);
    }
    process.exit(1);
  });
