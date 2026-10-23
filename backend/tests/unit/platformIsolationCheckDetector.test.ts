/**
 * DEEPTECH-PARALLEL-005 Batch 1 — `scripts/platform-isolation-check.ts`.
 *
 * Pins the three defects repaired in that script, each of which was silent
 * because nothing ran the detector and nothing tested it:
 *
 *   L-01  The paths handed to the rules and to the allowlist were ABSOLUTE
 *         (`C:/repo/pages/api/...`), while every rule predicate and every
 *         allowlist entry is keyed on the repo-relative form
 *         (`pages/api/...`). Two of the three rules and the whole allowlist
 *         could therefore never match.
 *   L-02  `SCAN_DIRS` overlaps (`pages` subsumes `pages/api/super-admin` and
 *         `pages/api/admin`) and each root was walked independently, so every
 *         file under a narrower root was scanned — and reported — twice.
 *   L-03  A stale allowlist entry (`super-admin/purchases/complete.ts`) whose
 *         stated justification no longer holds.
 *
 * Pattern precedent: routeAuth001Scanner.test.ts / routePolicyInventoryScript
 * .test.ts — unit-testing the exported scan functions of a plain-node gate.
 *
 * This detector is developer tooling. Nothing here asserts anything about
 * runtime authorization behaviour.
 */
export {};

/* eslint-disable @typescript-eslint/no-var-requires */
const detector = require('../../../scripts/platform-isolation-check');

type Hit = { file: string; line: number; text: string; category: string };

const SUPER_ADMIN_ROUTE = 'pages/api/super-admin/fixture-route.ts';

const LEGACY_FACADE_SRC = `
import { requireSuperAdminUser } from '../../../backend/auth/superAdminUser';
export default async function handler(req, res) {
  const admin = await requireSuperAdminUser(req, res);
  if (!admin) return;
  res.status(200).json({ ok: true });
}
`;

const SHARED_CAP_SRC = `
export default createApiRoute(handler, {
  route: '/api/super-admin/fixture',
  capability: BILLING_MANAGE,
});
`;

describe('L-01 — rules and allowlist are keyed on repo-relative paths', () => {
  it('toRepoRelative strips the repository prefix and normalises separators', () => {
    const abs = require('node:path').join(detector.REPO_ROOT, 'pages', 'api', 'super-admin', 'x.ts');
    expect(detector.toRepoRelative(abs)).toBe('pages/api/super-admin/x.ts');
  });

  it('rule (1) fires on a repo-relative super-admin path (it could not before)', () => {
    const hits: Hit[] = detector.scanSource(SUPER_ADMIN_ROUTE, LEGACY_FACADE_SRC);
    expect(hits.map((h) => h.category)).toContain('super_admin_user_legacy');
  });

  it('rule (1) does NOT fire on an absolute path — the old, broken input shape', () => {
    const abs = `${detector.REPO_ROOT}/pages/api/super-admin/fixture-route.ts`;
    // Proves the rule really is prefix-gated, so the repair had to be at the
    // path-normalisation site rather than in the predicate.
    expect(detector.scanSource(abs, LEGACY_FACADE_SRC)).toEqual([]);
  });

  it('rule (2) fires for a per-tenant capability on a platform route', () => {
    const hits: Hit[] = detector.scanSource(SUPER_ADMIN_ROUTE, SHARED_CAP_SRC);
    expect(hits.map((h) => h.category)).toContain('shared_cap_in_platform_route');
  });

  it('the allowlist suppresses by repo-relative path', () => {
    const allowlisted = 'pages/api/super-admin/audit-logs.ts';
    expect(detector.ALLOWLIST.has(allowlisted)).toBe(true);
    expect(detector.scanSource(allowlisted, LEGACY_FACADE_SRC)).toEqual([]);
    // The same source at a non-allowlisted path is still reported.
    expect(detector.scanSource(SUPER_ADMIN_ROUTE, LEGACY_FACADE_SRC).length).toBeGreaterThan(0);
  });

  it('rule (3) still tolerates tests and scripts under the relative convention', () => {
    const src = "const isSuper = userRole === 'SUPER_ADMIN';";
    expect(detector.scanSource('pages/some-page.tsx', src).length).toBe(1);
    expect(detector.scanSource('tests/auth/x.ts', src)).toEqual([]);
    expect(detector.scanSource('backend/tests/unit/x.test.ts', src)).toEqual([]);
    expect(detector.scanSource('components/__tests__/x.tsx', src)).toEqual([]);
    expect(detector.scanSource('scripts/platform-isolation-check.ts', src)).toEqual([]);
  });

  it('every reported hit carries a repo-relative path, never an absolute one', () => {
    const { hits } = detector.collectHits() as { hits: Hit[] };
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.file).not.toMatch(/^([A-Za-z]:|\/)/);
      expect(h.file).not.toContain('\\');
    }
  });
});

describe('L-02 — overlapping scan roots scan each file exactly once', () => {
  it('collectFiles returns no duplicate paths despite nested roots', () => {
    const files: string[] = detector.collectFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(new Set(files).size).toBe(files.length);
  });

  it('adding a root already subsumed by another does not change the file set', () => {
    const wide: string[] = detector.collectFiles(['pages']);
    const withNested: string[] = detector.collectFiles([
      'pages/api/super-admin',
      'pages/api/admin',
      'pages',
    ]);
    expect(withNested).toEqual(wide);
  });

  it('a file under a doubly-covered root appears once in the report', () => {
    const { hits } = detector.collectHits() as { hits: Hit[] };
    const keys = hits.map((h) => `${h.file}:${h.line}:${h.category}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('L-03 — the stale allowlist entry is gone', () => {
  it('super-admin/purchases/complete.ts is no longer allowlisted', () => {
    expect(detector.ALLOWLIST.has('pages/api/super-admin/purchases/complete.ts')).toBe(false);
  });
});

describe('the previously proven false negative is now detected', () => {
  it('pages/api/super-admin/creator-operations.ts is reported as a legacy-facade user', () => {
    const hits: Hit[] = detector.scanFile('pages/api/super-admin/creator-operations.ts');
    const legacy = hits.filter((h) => h.category === 'super_admin_user_legacy');
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy[0].text).toContain('requireSuperAdminUser(');
  });

  it('the full run reports it exactly once', () => {
    const { hits } = detector.collectHits() as { hits: Hit[] };
    const legacy = hits.filter((h) => h.category === 'super_admin_user_legacy');
    expect(legacy.map((h) => h.file)).toEqual(['pages/api/super-admin/creator-operations.ts']);
  });
});
