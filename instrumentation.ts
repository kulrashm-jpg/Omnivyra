/**
 * Next.js Instrumentation Hook — entry point
 *
 * All Node.js-specific startup logic (Redis, workers, cron) lives in
 * `instrumentation.node.ts`. We dynamically import it only when NOT in Edge
 * runtime, preventing the Edge bundler from analyzing the Node.js-only
 * import chain (Redis, fs, crypto, os, etc.).
 *
 * Note: NEXT_RUNTIME is 'edge' in Edge runtime, 'nodejs' or undefined in Node.
 * Guard against 'edge' rather than requiring 'nodejs' to handle both cases.
 */

// ── TEMP DIAGNOSTIC: worker-bootstrap audit ──
// Writes a sentinel file at every milestone so we can prove what executed
// without relying on Next/Turbopack stdout routing. Remove after diagnosis.
import * as _diag_fs from 'fs';
import * as _diag_path from 'path';
function _diag(stage: string, extra?: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), stage, ...extra }) + '\n';
    _diag_fs.appendFileSync(_diag_path.join(process.cwd(), '.worker-bootstrap.log'), line);
  } catch { /* never throw from diagnostics */ }
}
_diag('instrumentation.ts:module-loaded', { runtime: process.env.NEXT_RUNTIME ?? 'unset', pid: process.pid });

export async function register() {
  _diag('instrumentation.ts:register-entered', { runtime: process.env.NEXT_RUNTIME ?? 'unset' });
  if (process.env.NEXT_RUNTIME !== 'edge') {
    try {
      const { register: nodeRegister } = await import('./instrumentation.node');
      _diag('instrumentation.ts:node-module-imported');
      await nodeRegister();
      _diag('instrumentation.ts:node-register-returned');
    } catch (err) {
      _diag('instrumentation.ts:node-register-threw', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  } else {
    _diag('instrumentation.ts:edge-skipped');
  }
  _diag('instrumentation.ts:register-exited');
}
