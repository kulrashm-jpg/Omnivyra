#!/usr/bin/env node
/**
 * Phase 2 invariant guard: token-write boundary.
 *
 * Detects direct writes to the encrypted token columns of:
 *   - public.social_accounts        (access_token, refresh_token)
 *   - public.community_ai_platform_tokens (access_token, refresh_token — deprecated)
 *
 * Phase 2 contract (per migration plan v2 §AMEND PHASE 2):
 *   ALL token mutations must route through backend/services/socialTokenService.ts.
 *   No code path may write directly to either table after Phase 2 begins.
 *
 * This script runs Pre-Phase-2 in advisory mode: it freezes the current set of
 * legacy writers as the allow-list. CI fails if a NEW writer is introduced.
 * The allow-list shrinks during Phase 2 migration until only socialTokenService
 * remains.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one file writes token columns and is not in the allow-list
 *   2 — internal script error (file system issue, etc.)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['backend', 'pages', 'lib', 'app'];
const EXCLUDED_DIRS = new Set([
  'node_modules', '.next', 'dist', '.git', 'archive', 'coverage',
  '_quarantine', '__generated__',
]);

/**
 * Files permitted to write token columns. Frozen at Phase 0 exit.
 *
 * Phase 2 migration shrinks this list as each file routes through
 * socialTokenService. By Phase 2 exit, the list MUST contain only:
 *   ['backend/services/socialTokenService.ts']
 *
 * Updates require a PR with justification (see migration plan §BLOCKER 1).
 */
const ALLOW_LIST = new Set([
  // ── Phase 2 canonical writer (does not yet exist; placeholder entry) ──
  'backend/services/socialTokenService.ts',

  // ── Pre-Phase-2 legacy writers — drain during Phase 2 ──
  'backend/auth/tokenStore.ts',                                          // setToken / encryptTokenColumns
  'backend/services/platformTokenService.ts',                            // community_ai_platform_tokens metadata
  'pages/api/auth/facebook/callback.ts',                                 // meta_oauth_apply RPC wrapping
  'pages/api/auth/linkedin/callback.ts',
  'pages/api/auth/x/callback.ts',
  'pages/api/auth/spotify/callback.ts',
  'pages/api/auth/pinterest/callback.ts',
  'pages/api/auth/tiktok/callback.ts',
  'pages/api/auth/youtube/callback.ts',
  'pages/api/community-ai/connectors/meta/callback.ts',
  'pages/api/community-ai/connectors/linkedin/callback.ts',
  'pages/api/community-ai/connectors/reddit/callback.ts',

  // ── Background jobs that mutate token state ──
  'backend/jobs/metaTokenRefreshJob.ts',
  'backend/jobs/socialAccountTokenRefreshJob.ts',
  'backend/auth/tokenRefresh.ts',                                        // refresh_status writes (not token cols, but in scan radius)

  // ── Disconnect paths (NULL out tokens) — route through socialTokenService.invalidate in Phase 2 ──
  'pages/api/accounts/[platform].ts',                                    // disconnect handler

  // ── Test fixtures (legitimate seed data) ──
  'backend/tests/integration/publish_flow.test.ts',
  'backend/tests/integration/communityAiTestHarness.ts',
]);

const TABLE_PATTERNS = [
  /\.from\(['"]social_accounts['"]\)/g,
  /\.from\(['"]community_ai_platform_tokens['"]\)/g,
];
const WRITE_METHOD_RE = /\.(insert|update|upsert)\b/;
const TOKEN_COL_RE = /\b(access_token|refresh_token)\b/;
const WINDOW_BYTES = 2000;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        yield* walk(full);
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

function fileWritesTokenColumns(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return false;
  }
  for (const pat of TABLE_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(content)) !== null) {
      const window = content.slice(m.index, m.index + WINDOW_BYTES);
      if (WRITE_METHOD_RE.test(window) && TOKEN_COL_RE.test(window)) {
        return true;
      }
    }
  }
  return false;
}

function main() {
  const violations = [];
  const matchedAllowed = [];

  for (const target of SCAN_ROOTS) {
    const dir = path.join(ROOT, target);
    if (!fs.existsSync(dir)) continue;
    for (const filePath of walk(dir)) {
      if (fileWritesTokenColumns(filePath)) {
        const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
        if (ALLOW_LIST.has(rel)) {
          matchedAllowed.push(rel);
        } else {
          violations.push(rel);
        }
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('TOKEN_WRITE_BOUNDARY_VIOLATION\n');
    process.stderr.write(
      `\n${violations.length} file(s) write token columns to social_accounts or ` +
      `community_ai_platform_tokens but are not in the Phase 2 allow-list:\n\n`
    );
    for (const v of violations) process.stderr.write(`  - ${v}\n`);
    process.stderr.write(
      `\nResolution paths:\n` +
      `  1. Route the write through backend/services/socialTokenService.ts (preferred).\n` +
      `  2. If this is a legitimate new writer that cannot route through the service,\n` +
      `     add it to ALLOW_LIST in scripts/check-token-write-boundary.js with PR\n` +
      `     justification. The allow-list MUST shrink during Phase 2, never grow.\n` +
      `\nSee migration plan §BLOCKER 1 (token consistency) for full contract.\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `✅ token-write-boundary OK\n` +
    `   ${matchedAllowed.length} writer(s) matched in allow-list (size: ${ALLOW_LIST.size})\n` +
    `   Phase 2 exit target: 1 (socialTokenService.ts only)\n`
  );
}

try {
  main();
} catch (e) {
  process.stderr.write(`token-write-boundary: internal error: ${e?.message ?? e}\n`);
  process.exit(2);
}
