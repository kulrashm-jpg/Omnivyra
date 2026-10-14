'use strict';
/**
 * Closure-014A — runner for scripts/cert/publish-worker-cert.ts.
 *
 * The root tsconfig emits ES modules, so the launcher must run through ts-node
 * in CommonJS mode (the repository's established form, as `audit:blog-matrix`).
 * A separate runner file keeps the launcher's own arguments (e.g. `--check`)
 * out of Node's option parsing — `node -e "…" --check` is Node's syntax-check
 * flag and exits 9.
 *
 *   ENV_FILE=.env.cert CERT_FAKE_PUBLISHER=1 node scripts/cert/publish-worker-cert.cjs [--check]
 */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'commonjs' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
require('./publish-worker-cert.ts');
