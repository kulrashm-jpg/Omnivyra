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
const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'commonjs' });
require('ts-node/register/transpile-only');
// Closure-014C — the root tsconfig declares `paths` ("@/*": ["./*"]) but no
// `baseUrl`, so a bare `tsconfig-paths/register` skips itself ("Missing
// baseUrl") and every '@/…' import in the worker graph fails at a real start.
// tsconfig-paths' supported overrides pin the project file and the base the
// paths are relative to, independent of the cwd. TS_NODE_BASEURL is joined to
// the tsconfig's directory (as a tsconfig baseUrl is), so it must be '.', not
// an absolute path (tsconfig-paths 3.x would join two absolute paths).
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '..', '..', 'tsconfig.json');
process.env.TS_NODE_BASEURL = '.';
require('tsconfig-paths/register');
require('./publish-worker-cert.ts');
