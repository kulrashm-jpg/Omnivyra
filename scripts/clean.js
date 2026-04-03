#!/usr/bin/env node
/**
 * Clean build artifacts: .next, dist, .vercel
 * No external dependencies — uses Node.js built-in fs.promises.rm.
 *
 * Modes:
 *   node scripts/clean.js           — delete all dirs in parallel, await completion (for build)
 *   node scripts/clean.js --bg      — fire-and-forget background deletion (for dev/start)
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dirs = ['.next', 'dist', '.vercel'];
const isBg = process.argv.includes('--bg');

async function cleanAll() {
  await Promise.all(
    dirs.map(async (dir) => {
      const target = path.join(root, dir);
      try {
        await fs.promises.rm(target, { recursive: true, force: true });
        if (!isBg) console.log(`🧹 Cleared ${dir}/`);
      } catch (e) {
        if (!isBg) console.warn(`⚠️  Could not clear ${dir}/: ${e.message}`);
      }
    })
  );
}

if (isBg) {
  // Fire and forget — parent process doesn't wait
  cleanAll().catch(() => {});
} else {
  // Await completion — used by build so old files are gone before next build writes
  cleanAll().then(() => process.exit(0)).catch(() => process.exit(1));
}
