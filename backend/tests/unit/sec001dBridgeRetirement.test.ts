/**
 * SEC-001D — Final legacy bridge retirement & production cutover.
 *
 * SEC-001C left ONE operational blocker: two routes whose only authorization
 * source was the bridge, which would become permanently unreachable once
 * LEGACY_BRIDGE_HARD_EXPIRY_AT passed. SEC-001D migrated both.
 *
 * This suite is the CUTOVER GATE. It answers, mechanically:
 *   1. Is any production route still bridge-only?           (must be: no)
 *   2. Under LEGACY_BRIDGE_DRY_RUN=1, is every bridge use
 *      rejected AND reported?                               (must be: yes)
 *   3. Simulating the hard expiry, do BOTH bridge entry
 *      points grant nothing?                                (must be: yes)
 *
 * (1) ∧ (3) ⇒ removing the bridge breaks no route. (2) ⇒ the pre-cutover
 * dry-run observation is trustworthy, because no consumer is invisible to it.
 */
import fs from 'fs';
import path from 'path';
import type { NextApiRequest } from 'next';

process.env.BRIDGE_COOKIE_SECRET =
  process.env.BRIDGE_COOKIE_SECRET || 'sec001d-test-bridge-secret-at-least-32-chars-long';

const auditEvents: Array<Record<string, unknown>> = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn((e: Record<string, unknown>) => {
    auditEvents.push(e);
    return Promise.resolve();
  }),
  logCookieSuperAdminUsage: jest.fn((e: Record<string, unknown>) => {
    auditEvents.push(e);
    return Promise.resolve();
  }),
}));

import { mintSignedBridgeCookieValue } from '../../security/bridgeCookie';
import {
  LEGACY_BRIDGE_HARD_EXPIRY_AT,
  evaluateBridgeCookieLifecycle,
  resolveLegacyCookieSuperAdminPrincipal,
} from '../../security/legacyCookieSuperAdminBridge';
import {
  getLegacySuperAdminSession,
  getBridgeBypassMetrics,
  resetBridgeBypassMetrics,
} from '../../services/superAdminSession';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HARD_EXPIRY_MS = LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime();
const BEFORE_EXPIRY_MS = HARD_EXPIRY_MS - 60 * 60 * 1000;
const AFTER_EXPIRY_MS = HARD_EXPIRY_MS + 30 * 60 * 1000;

let nowMs = BEFORE_EXPIRY_MS;
const setNow = (ms: number) => {
  nowMs = ms;
};
const mintAt = (ms: number): string => {
  const prev = nowMs;
  nowMs = ms;
  try {
    return mintSignedBridgeCookieValue();
  } finally {
    nowMs = prev;
  }
};

function reqWith(cookie: string, url = '/api/super-admin/example'): NextApiRequest {
  return {
    cookies: { super_admin_session: cookie },
    url,
    headers: { 'user-agent': 'jest', cookie: `super_admin_session=${cookie}` },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  auditEvents.length = 0;
  resetBridgeBypassMetrics();
  delete process.env.LEGACY_BRIDGE_DRY_RUN;
  nowMs = BEFORE_EXPIRY_MS;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.LEGACY_BRIDGE_DRY_RUN;
});

// ── Source inventory helpers ───────────────────────────────────────────
function collectRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, 'pages', 'api'));
  return out;
}
const rel = (f: string) => path.relative(REPO_ROOT, f).replace(/\\/g, '/');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const CANONICAL_ARM =
  /isPlatformSuperAdmin|requireCapability|getUserRole|assertTenantAccess|enforceCompanyAccess|resolveCompanyAccess|getCompanyRoleIncludingInvited|getSupabaseUserFromRequest/;

/**
 * Extract the enclosing function body for each `getLegacySuperAdminSession`
 * call by brace-matching outward from the call site. Used to prove the
 * canonical arm sits in the SAME gate as the bridge call — a canonical import
 * elsewhere in the file would not actually keep the route reachable.
 */
function enclosingBodies(src: string): string[] {
  const bodies: string[] = [];
  const needle = 'getLegacySuperAdminSession';
  let idx = src.indexOf(needle);
  while (idx !== -1) {
    // Walk back to the opening brace of the enclosing block.
    let depth = 0;
    let start = idx;
    for (let i = idx; i >= 0; i--) {
      if (src[i] === '}') depth++;
      else if (src[i] === '{') {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
    // Walk forward to its matching close.
    let d = 0;
    let end = src.length;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') {
        d--;
        if (d === 0) {
          end = i;
          break;
        }
      }
    }
    bodies.push(src.slice(start, end + 1));
    idx = src.indexOf(needle, idx + needle.length);
  }
  return bodies;
}

// ══ TASK 1/2 — final dependency inventory ══════════════════════════════
describe('SEC-001D — final dependency inventory', () => {
  const routes = collectRoutes();
  const bridgeRoutes = routes.filter((f) =>
    /getLegacySuperAdminSession/.test(stripComments(fs.readFileSync(f, 'utf8')))
  );

  it('found the bridge-gating route surface (guards against a vacuous pass)', () => {
    expect(bridgeRoutes.length).toBeGreaterThanOrEqual(50);
  });

  it('ZERO routes are BRIDGE-ONLY — every one has a canonical arm', () => {
    const bridgeOnly = bridgeRoutes.filter(
      (f) => !CANONICAL_ARM.test(stripComments(fs.readFileSync(f, 'utf8')))
    );
    expect(bridgeOnly.map(rel)).toEqual([]);
  });

  it('the canonical arm lives in the SAME gate as the bridge call, not merely in the file', () => {
    const offenders: string[] = [];
    for (const f of bridgeRoutes) {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const bodies = enclosingBodies(src);
      // At least one gate must pair the bridge check with a canonical arm.
      if (!bodies.some((b) => CANONICAL_ARM.test(b))) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });
});

// ══ TASK 7 — the lifecycle sequence exists exactly once ════════════════
describe('SEC-001D — one lifecycle evaluation, repository-wide', () => {
  const owner = path.join(REPO_ROOT, 'backend/security/legacyCookieSuperAdminBridge.ts');
  const ownerSrc = stripComments(fs.readFileSync(owner, 'utf8'));

  it('the lifecycle owner parses the cookie in exactly ONE place', () => {
    // SEC-001D: resolveLegacyCookieSuperAdminPrincipal used to parse the
    // cookies itself and then re-run the dry-run and hard-expiry arms — a
    // second copy of the sequence inside the same module.
    expect((ownerSrc.match(/parseSignedBridgeCookie\(/g) ?? []).length).toBe(1);
  });

  it('the dry-run and hard-expiry arms are evaluated in exactly ONE place', () => {
    // One definition + one call inside the evaluator.
    expect((ownerSrc.match(/isLegacyBridgeDryRun\(\)/g) ?? []).length).toBe(2);
    expect((ownerSrc.match(/LEGACY_BRIDGE_HARD_EXPIRY_AT\.getTime\(\)/g) ?? []).length).toBe(1);
  });

  it('BOTH bridge entry points agree, because they share the one decision', async () => {
    setNow(AFTER_EXPIRY_MS);
    const cookie = mintAt(AFTER_EXPIRY_MS - 60 * 1000);
    const routeVerdict = getLegacySuperAdminSession(reqWith(cookie));
    const capabilityVerdict = await resolveLegacyCookieSuperAdminPrincipal(reqWith(cookie));
    expect(routeVerdict).toBeNull();
    expect(capabilityVerdict).toBeNull();
  });
});

// ══ TASK 4 — dry-run verification ══════════════════════════════════════
describe('SEC-001D — dry-run makes every bridge consumer visible', () => {
  it('route entry point: rejects, counts, and audits under dry-run', () => {
    const cookie = mintAt(BEFORE_EXPIRY_MS);
    process.env.LEGACY_BRIDGE_DRY_RUN = '1';

    expect(getLegacySuperAdminSession(reqWith(cookie, '/api/cron/credit-expiry'))).toBeNull();

    const m = getBridgeBypassMetrics();
    expect(m.rejectedDryRun).toBe(1);
    expect(m.granted).toBe(0);
    expect(m.byRoute['/api/cron/credit-expiry']).toBe(1); // consumer is NOT invisible
    const rej = auditEvents.filter((e) => e.decision === 'bridge_authority_rejected');
    expect(rej).toHaveLength(1);
    expect(String(rej[0].reason)).toContain('LEGACY_BRIDGE_DRY_RUN');
  });

  it('capability entry point: rejects and audits under dry-run', async () => {
    const cookie = mintAt(BEFORE_EXPIRY_MS);
    process.env.LEGACY_BRIDGE_DRY_RUN = '1';

    await expect(resolveLegacyCookieSuperAdminPrincipal(reqWith(cookie))).resolves.toBeNull();
    expect(
      auditEvents.some(
        (e) =>
          e.decision === 'bridge_authority_rejected' &&
          String(e.reason).includes('LEGACY_BRIDGE_DRY_RUN')
      )
    ).toBe(true);
  });

  it('dry-run counts REAL dependencies only — a forged cookie is not counted as one', () => {
    process.env.LEGACY_BRIDGE_DRY_RUN = '1';
    getLegacySuperAdminSession(reqWith('1', '/api/super-admin/thing'));
    // Signature is evaluated first, so the forgery never reaches the dry-run arm.
    expect(getBridgeBypassMetrics().rejectedDryRun).toBe(0);
  });
});

// ══ TASK 5 — bridge removal simulation ═════════════════════════════════
describe('SEC-001D — hard-expiry simulation: the bridge grants nothing', () => {
  it('route entry point grants nothing past the expiry', () => {
    setNow(AFTER_EXPIRY_MS);
    const fresh = mintAt(AFTER_EXPIRY_MS - 60 * 1000); // 1 minute old: age is not the cause
    expect(getLegacySuperAdminSession(reqWith(fresh))).toBeNull();
    expect(getBridgeBypassMetrics().rejectedHardExpired).toBe(1);
  });

  it('capability entry point grants nothing past the expiry', async () => {
    setNow(AFTER_EXPIRY_MS);
    const fresh = mintAt(AFTER_EXPIRY_MS - 60 * 1000);
    await expect(resolveLegacyCookieSuperAdminPrincipal(reqWith(fresh))).resolves.toBeNull();
  });

  it('the shared evaluator reports hard_expired — one decision, both callers', () => {
    setNow(AFTER_EXPIRY_MS);
    const fresh = mintAt(AFTER_EXPIRY_MS - 60 * 1000);
    expect(evaluateBridgeCookieLifecycle(fresh)).toEqual({
      ok: false,
      reason: 'hard_expired',
    });
  });

  it('NO cookie value of any shape can revive the bridge past the expiry', () => {
    setNow(AFTER_EXPIRY_MS);
    for (const v of ['1', 'true', mintAt(AFTER_EXPIRY_MS), mintAt(AFTER_EXPIRY_MS - 1000)]) {
      expect(getLegacySuperAdminSession(reqWith(v))).toBeNull();
    }
  });
});
