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
 * Usage:
 *   npx tsx scripts/platform-isolation-check.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Hit {
  file: string;
  line: number;
  text: string;
  category: 'super_admin_user_legacy' | 'shared_cap_in_platform_route' | 'role_equality';
}

const SCAN_DIRS = ['pages/api/super-admin', 'pages/api/admin', 'components', 'pages'] as const;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git']);

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
const ALLOWLIST = new Set<string>([
  // Tenant routes that correctly pass `organizationId`:
  'pages/api/team/self-joined.ts',
  'pages/api/virality/playbooks/index.ts',
  'pages/api/virality/playbooks/[id].ts',
  // Super-admin/purchases/complete uses BILLING_PURCHASE intentionally per-org:
  'pages/api/super-admin/purchases/complete.ts',
  // Phase: Platform Authority Legacy Facade Elimination — these routes now
  // canonical (no longer grandfathered). Allowlisted because the file still
  // mentions `requireSuperAdminUser` in COMMENTS / migration notes; the
  // detector matches by source line, so we exempt the migrated files.
  'pages/api/super-admin/audit-logs.ts',
  'pages/api/super-admin/companies.ts',
  'pages/api/super-admin/credits/grant.ts',
  'pages/api/super-admin/users.ts',
]);

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

function scanFile(file: string): Hit[] {
  const rel = file.replace(/\\/g, '/');
  if (ALLOWLIST.has(rel)) return [];
  const src = readFileSync(file, 'utf8');
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
      // Tolerate test files + audit reports + this script
      if (!rel.includes('/tests/') && !rel.includes('/__tests__/') && !rel.includes('/scripts/')) {
        hits.push({ file: rel, line: i + 1, text: text.trim(), category: 'role_equality' });
      }
    }
  }
  return hits;
}

function main(): void {
  const cwd = process.cwd();
  const all: Hit[] = [];
  for (const d of SCAN_DIRS) {
    const root = join(cwd, d);
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of walk(root)) {
      all.push(...scanFile(file));
    }
  }

  const byCategory: Record<Hit['category'], Hit[]> = {
    super_admin_user_legacy: [],
    shared_cap_in_platform_route: [],
    role_equality: [],
  };
  for (const h of all) byCategory[h.category].push(h);

  console.log(`platform-isolation-check: ${all.length} potential boundary issues across ${SCAN_DIRS.length} scan roots`);
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

main();
