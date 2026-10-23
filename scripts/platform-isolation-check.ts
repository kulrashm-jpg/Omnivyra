/**
 * platform-isolation-check — static detector for platform/tenant authority
 * boundary violations.
 *
 * Phase: Platform Authority Hard Enforcement.
 *
 * Catches drift the runtime invariant cannot — patterns that compile cleanly
 * but indicate the boundary may be eroding. Soft-warning by default; intended
 * to be reviewed during PR review or wired into CI.
 *
 * What this script flags:
 *   1. `requireSuperAdminUser(req, res)` consumers in `pages/api/super-admin/*` —
 *      candidates for migration to canonical `requireCapability` + platform-tier
 *      capability. The legacy facade is Bearer-only DB-backed (no canonical
 *      audit linkage; no step-up policy).
 *   2. `BILLING_MANAGE` / `ORGANIZATION_MANAGE` / `INTEGRATION_MANAGE` / etc.
 *      passed to `requireCapability` in `pages/api/super-admin/*` — these are
 *      per-tenant capabilities and should be platform-tier when used on
 *      platform routes.
 *   3. Hardcoded `userRole === 'SUPER_ADMIN'` literal-equality checks in
 *      visibility / authorization positions outside the allowlist.
 *
 * What this script does NOT do:
 *   - Auto-fix anything (the migration target depends on the route's intent).
 *   - Block CI by default.
 *   - Replace the runtime invariant in `platformCapabilities.ts`.
 *
 * Path convention (DEEPTECH-PARALLEL-005 Batch 1, L-01):
 *   Every path this script compares, allowlists or prints is **repository
 *   relative** with forward slashes (`pages/api/super-admin/foo.ts`). The
 *   filesystem walk necessarily produces absolute paths; `toRepoRelative()` is
 *   the single place that converts, and it is applied before any rule or
 *   allowlist lookup sees a path. Previously `rel` was still absolute, so the
 *   allowlist and rules (1) and (2) — all keyed on a `pages/api/super-admin/`
 *   prefix — could never match.
 *
 * Usage:
 *   npx tsx scripts/platform-isolation-check.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface Hit {
  file: string;
  line: number;
  text: string;
  category: 'super_admin_user_legacy' | 'shared_cap_in_platform_route' | 'role_equality';
}

/**
 * Declared scan roots. These deliberately overlap (`pages` subsumes
 * `pages/api/super-admin` and `pages/api/admin`) because the narrower entries
 * document where the boundary matters most. Overlap no longer inflates the
 * report: `collectFiles()` de-duplicates by repo-relative path, so each file is
 * scanned exactly once regardless of how many roots contain it (L-02).
 */
export const SCAN_DIRS = ['pages/api/super-admin', 'pages/api/admin', 'components', 'pages'] as const;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git']);

/** Repository root — this file lives in `<repo>/scripts/`. */
export const REPO_ROOT = typeof __dirname === 'string' ? resolve(__dirname, '..') : process.cwd();

const SHARED_CAP_NAMES = new Set([
  'BILLING_MANAGE',
  'BILLING_PURCHASE',
  'ORGANIZATION_MANAGE',
  'INTEGRATION_MANAGE',
  'API_KEY_MANAGE',
  'CAMPAIGN_EXECUTE',
  'CAMPAIGN_DELETE',
  'CONTENT_PUBLISH',
  'CONTENT_DELETE',
]);

// Files that legitimately use the legacy facade or shared caps with org binding.
// Entries are repository-relative with forward slashes — see the path
// convention note in the header.
export const ALLOWLIST = new Set<string>([
  // Tenant routes that correctly pass `organizationId`:
  'pages/api/team/self-joined.ts',
  'pages/api/virality/playbooks/index.ts',
  'pages/api/virality/playbooks/[id].ts',
  // Phase: Platform Authority Legacy Facade Elimination — these routes now
  // canonical (no longer grandfathered). Allowlisted because the file still
  // mentions `requireSuperAdminUser` in COMMENTS / migration notes; the
  // detector matches by source line, so we exempt the migrated files.
  'pages/api/super-admin/audit-logs.ts',
  'pages/api/super-admin/companies.ts',
  'pages/api/super-admin/credits/grant.ts',
  'pages/api/super-admin/users.ts',
  // Pruned (L-03): 'pages/api/super-admin/purchases/complete.ts' was
  // allowlisted as "uses BILLING_PURCHASE intentionally per-org". No
  // shared-capability line and no `requireSuperAdminUser` mention remains in
  // that file, so the justification no longer holds and the entry suppressed
  // nothing it needed to.
]);

/** Convert an absolute (or already relative) path to a repo-relative POSIX path. */
export function toRepoRelative(file: string, repoRoot: string = REPO_ROOT): string {
  const rel = relative(repoRoot, resolve(repoRoot, file));
  return rel.replace(/\\/g, '/');
}

/** True when `segment` appears as a whole path segment of a repo-relative path. */
function hasSegment(rel: string, segment: string): boolean {
  return rel === segment || rel.startsWith(`${segment}/`) || rel.includes(`/${segment}/`);
}

function* walk(root: string): Generator<string> {
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(root, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      yield* walk(path);
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      yield path;
    }
  }
}

/**
 * Repo-relative, de-duplicated, sorted list of files to scan. Overlapping scan
 * roots (L-02) can no longer cause a file to be scanned — and therefore
 * reported — more than once.
 */
export function collectFiles(
  dirs: readonly string[] = SCAN_DIRS,
  repoRoot: string = REPO_ROOT,
): string[] {
  const seen = new Set<string>();
  for (const d of dirs) {
    const root = join(repoRoot, d);
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of walk(root)) {
      seen.add(toRepoRelative(file, repoRoot));
    }
  }
  return [...seen].sort();
}

/**
 * Pure rule evaluation. `rel` MUST be a repo-relative POSIX path — every rule
 * and the allowlist are keyed on that form.
 */
export function scanSource(rel: string, src: string, allowlist: Set<string> = ALLOWLIST): Hit[] {
  if (allowlist.has(rel)) return [];
  const lines = src.split(/\r?\n/);
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';

    // (1) Legacy facade in super-admin/* routes
    if (rel.startsWith('pages/api/super-admin/') && /\brequireSuperAdminUser\s*\(/.test(text)) {
      hits.push({ file: rel, line: i + 1, text: text.trim(), category: 'super_admin_user_legacy' });
    }

    // (2) Shared per-tenant capability used on a super-admin platform route
    if (rel.startsWith('pages/api/super-admin/')) {
      const m = text.match(/capability:\s*([A-Z_]+),?/);
      if (m && SHARED_CAP_NAMES.has(m[1])) {
        hits.push({ file: rel, line: i + 1, text: text.trim(), category: 'shared_cap_in_platform_route' });
      }
    }

    // (3) Hardcoded role-equality checks in visibility/authorization positions
    if (/userRole\s*===\s*['"]SUPER_ADMIN['"]/.test(text) || /role\s*===\s*['"]SUPER_ADMIN['"]/.test(text)) {
      // Tolerate test files + audit reports + this script. Segment matching, so
      // a top-level `tests/` or `scripts/` directory is tolerated exactly as it
      // was when these paths were absolute.
      if (!hasSegment(rel, 'tests') && !hasSegment(rel, '__tests__') && !hasSegment(rel, 'scripts')) {
        hits.push({ file: rel, line: i + 1, text: text.trim(), category: 'role_equality' });
      }
    }
  }
  return hits;
}

export function scanFile(rel: string, repoRoot: string = REPO_ROOT): Hit[] {
  const src = readFileSync(join(repoRoot, rel), 'utf8');
  return scanSource(rel, src);
}

export function collectHits(
  dirs: readonly string[] = SCAN_DIRS,
  repoRoot: string = REPO_ROOT,
): { hits: Hit[]; filesScanned: number } {
  const files = collectFiles(dirs, repoRoot);
  const hits: Hit[] = [];
  for (const rel of files) hits.push(...scanFile(rel, repoRoot));
  return { hits, filesScanned: files.length };
}

export function main(): void {
  const { hits: all, filesScanned } = collectHits();

  const byCategory: Record<Hit['category'], Hit[]> = {
    super_admin_user_legacy: [],
    shared_cap_in_platform_route: [],
    role_equality: [],
  };
  for (const h of all) byCategory[h.category].push(h);

  console.log(
    `platform-isolation-check: ${all.length} potential boundary issues in ${filesScanned} distinct files across ${SCAN_DIRS.length} scan roots`,
  );
  console.log('');
  for (const cat of Object.keys(byCategory) as Hit['category'][]) {
    const hits = byCategory[cat];
    if (hits.length === 0) continue;
    console.log(`[${cat}] (${hits.length})`);
    for (const h of hits.slice(0, 20)) {
      console.log(`  ${h.file}:${h.line}  ${h.text}`);
    }
    if (hits.length > 20) console.log(`  ... ${hits.length - 20} more`);
    console.log('');
  }

  console.log('Categories:');
  console.log('  super_admin_user_legacy       — legacy `requireSuperAdminUser` Bearer-only check; migrate to requireCapability + platform-tier capability');
  console.log('  shared_cap_in_platform_route  — per-tenant capability used on a platform route; migrate to a platform-tier capability');
  console.log("  role_equality                 — literal `=== 'SUPER_ADMIN'` check; migrate to canonical capability check");
  console.log('');
  console.log('Allowlisted files:', ALLOWLIST.size);
  console.log('See backend/security/platformCapabilities.ts for the platform-tier list.');
}

// Run only when executed directly, so the rule functions above can be imported
// by tests without producing a report.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
}
