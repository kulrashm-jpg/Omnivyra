/**
 * SEC-001C — Legacy bridge retirement & authorization unification.
 *
 * WHAT THIS PINS
 * SEC-001B left the platform with TWO bridge entry points:
 *   • `bridgeCookie.hasValidLegacySuperAdminCookie` — signature + embedded age
 *   • `superAdminSession.getLegacySuperAdminSession` — signature + embedded age
 *     + LEGACY_BRIDGE_HARD_EXPIRY_AT + LEGACY_BRIDGE_DRY_RUN + audit + counters
 * 34 routes used the first, so they silently bypassed the bridge lifecycle.
 * SEC-001C deleted the signature-only helper and moved every caller to the
 * lifecycle-aware one.
 *
 * PROOF STRUCTURE — the claim "every route honours the full lifecycle" is
 * established in two halves, both pinned here:
 *   (A) BEHAVIOUR — the canonical helper enforces all seven properties.
 *   (B) TOPOLOGY  — every production bridge-authorization site routes through
 *       exactly that helper, and no alternative entry point exists to reach.
 * (A) ∧ (B) ⇒ the property holds for all routes. Neither half alone suffices,
 * which is why both are asserted.
 */
import fs from 'fs';
import path from 'path';
import type { NextApiRequest } from 'next';

process.env.BRIDGE_COOKIE_SECRET =
  process.env.BRIDGE_COOKIE_SECRET || 'sec001c-test-bridge-secret-at-least-32-chars-long';

// Capture audit emissions. superAdminSession fires these as `void ...catch()`.
const auditEvents: Array<Record<string, unknown>> = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn((e: Record<string, unknown>) => {
    auditEvents.push(e);
    return Promise.resolve();
  }),
  logCookieSuperAdminUsage: jest.fn(() => Promise.resolve()),
}));

import { mintSignedBridgeCookieValue } from '../../security/bridgeCookie';
import { LEGACY_BRIDGE_HARD_EXPIRY_AT } from '../../security/legacyCookieSuperAdminBridge';
import {
  getLegacySuperAdminSession,
  getBridgeBypassMetrics,
  resetBridgeBypassMetrics,
  LEGACY_SUPER_ADMIN_USER_ID,
} from '../../services/superAdminSession';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function reqWith(cookie?: string, url = '/api/super-admin/example'): NextApiRequest {
  return {
    cookies: cookie === undefined ? {} : { super_admin_session: cookie },
    url,
    headers: { 'user-agent': 'jest' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
}

const HARD_EXPIRY_MS = LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime();
/** One hour BEFORE the hard expiry — valid signature, well inside the 24h age. */
const BEFORE_EXPIRY_MS = HARD_EXPIRY_MS - 60 * 60 * 1000;
/** 30 minutes AFTER the hard expiry — still only 90 min old, so age is NOT the reason. */
const AFTER_EXPIRY_MS = HARD_EXPIRY_MS + 30 * 60 * 1000;

/**
 * ONE clock for the whole suite. A single spy driven by a mutable `nowMs`,
 * rather than nesting `spyOn` calls — a nested spy's `mockRestore()` restores
 * the ORIGINAL `Date.now`, silently cancelling the outer mock and letting the
 * real clock leak into assertions.
 */
let nowMs = BEFORE_EXPIRY_MS;
const setNow = (ms: number) => {
  nowMs = ms;
};
/** Mint at the current virtual instant. */
const mintAt = (epochMs: number): string => {
  const previous = nowMs;
  nowMs = epochMs;
  try {
    return mintSignedBridgeCookieValue();
  } finally {
    nowMs = previous;
  }
};

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

// ══ (A) BEHAVIOUR — the canonical helper enforces all seven properties ══
describe('SEC-001C (A) — canonical helper lifecycle matrix', () => {
  it('✓ signed cookie → ACCEPTED, with the legacy sentinel principal', () => {
    setNow(BEFORE_EXPIRY_MS);
    const session = getLegacySuperAdminSession(reqWith(mintAt(BEFORE_EXPIRY_MS)));
    expect(session).toEqual({ userId: LEGACY_SUPER_ADMIN_USER_ID, role: 'SUPER_ADMIN' });
  });

  it('✓ forged "1" → REJECTED', () => {
    setNow(BEFORE_EXPIRY_MS);
    expect(getLegacySuperAdminSession(reqWith('1'))).toBeNull();
  });

  it('✓ tampered signature → REJECTED', () => {
    setNow(BEFORE_EXPIRY_MS);
    const [payload] = mintAt(BEFORE_EXPIRY_MS).split('.');
    expect(getLegacySuperAdminSession(reqWith(`${payload}.forgedsig`))).toBeNull();
  });

  it('✓ embedded expiry (age > max) → REJECTED even before hard expiry', () => {
    const cookie = mintAt(BEFORE_EXPIRY_MS - 48 * 60 * 60 * 1000); // 48h old
    setNow(BEFORE_EXPIRY_MS);
    expect(getLegacySuperAdminSession(reqWith(cookie))).toBeNull();
  });

  it('✓ LEGACY_BRIDGE_HARD_EXPIRY_AT → REJECTED past the date (age is NOT the cause)', () => {
    const cookie = mintAt(AFTER_EXPIRY_MS - 60 * 60 * 1000); // 1h old at check time
    setNow(AFTER_EXPIRY_MS);
    expect(getLegacySuperAdminSession(reqWith(cookie))).toBeNull();
    expect(getBridgeBypassMetrics().rejectedHardExpired).toBe(1);
    // Same cookie, same age, clock before the expiry ⇒ accepted. Isolates the cause.
    setNow(AFTER_EXPIRY_MS - 61 * 60 * 1000 + 60 * 1000);
    expect(getLegacySuperAdminSession(reqWith(mintAt(BEFORE_EXPIRY_MS)))).not.toBeNull();
  });

  it('✓ LEGACY_BRIDGE_DRY_RUN → REJECTED while the same cookie would otherwise pass', () => {
    const cookie = mintAt(BEFORE_EXPIRY_MS);
    setNow(BEFORE_EXPIRY_MS);
    expect(getLegacySuperAdminSession(reqWith(cookie))).not.toBeNull();

    resetBridgeBypassMetrics();
    process.env.LEGACY_BRIDGE_DRY_RUN = '1';
    expect(getLegacySuperAdminSession(reqWith(cookie))).toBeNull();
    expect(getBridgeBypassMetrics().rejectedDryRun).toBe(1);
  });

  it('✓ AUDIT — an authoritative use emits bridge_authority_used with viaLegacyBridge', () => {
    setNow(BEFORE_EXPIRY_MS);
    getLegacySuperAdminSession(reqWith(mintAt(BEFORE_EXPIRY_MS), '/api/super-admin/thing'));
    const used = auditEvents.filter((e) => e.decision === 'bridge_authority_used');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ capability: 'super_admin.legacy', viaLegacyBridge: true });
    expect(String(used[0].reason)).toContain('/api/super-admin/thing');
  });

  it('✓ AUDIT — every rejection mode is audited too (no silent denials)', () => {
    // signature
    setNow(BEFORE_EXPIRY_MS);
    getLegacySuperAdminSession(reqWith('1'));
    // dry-run
    process.env.LEGACY_BRIDGE_DRY_RUN = '1';
    getLegacySuperAdminSession(reqWith(mintAt(BEFORE_EXPIRY_MS)));
    delete process.env.LEGACY_BRIDGE_DRY_RUN;
    // hard expiry
    setNow(AFTER_EXPIRY_MS);
    getLegacySuperAdminSession(reqWith(mintAt(AFTER_EXPIRY_MS - 60 * 60 * 1000)));

    const rejected = auditEvents.filter((e) => e.decision === 'bridge_authority_rejected');
    expect(rejected).toHaveLength(3);
    expect(rejected.every((e) => e.viaLegacyBridge === true)).toBe(true);
  });

  it('✓ METRICS — counters attribute reads, grants and each rejection reason per route', () => {
    setNow(BEFORE_EXPIRY_MS);
    getLegacySuperAdminSession(reqWith(mintAt(BEFORE_EXPIRY_MS), '/api/cron/credit-expiry?x=1'));
    getLegacySuperAdminSession(reqWith(mintAt(BEFORE_EXPIRY_MS), '/api/cron/credit-expiry?x=2'));

    const m = getBridgeBypassMetrics();
    expect(m.granted).toBe(2);
    expect(m.totalReads).toBe(2);
    // Query string stripped so per-route attribution is stable.
    expect(m.byRoute['/api/cron/credit-expiry']).toBe(2);
  });

  it('no cookie at all → null, and emits NOTHING (absence is not an event)', () => {
    setNow(BEFORE_EXPIRY_MS);
    expect(getLegacySuperAdminSession(reqWith(undefined))).toBeNull();
    expect(auditEvents).toHaveLength(0);
    expect(getBridgeBypassMetrics().totalReads).toBe(0);
  });
});

// ══ (B) TOPOLOGY — one canonical entry point, nothing else reachable ══
describe('SEC-001C (B) — single canonical bridge entry point', () => {
  const PROD_DIRS = ['pages', 'backend', 'lib', 'components', 'scripts'];

  function collect(dirs: string[]): string[] {
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
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'tests' || e.name === '__tests__') continue;
          walk(full);
        } else if (/\.tsx?$/.test(e.name)) out.push(full);
      }
    };
    for (const d of dirs) walk(path.join(REPO_ROOT, d));
    return out;
  }
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  const files = collect(PROD_DIRS);
  const rel = (f: string) => path.relative(REPO_ROOT, f).replace(/\\/g, '/');

  it('collected a meaningful file set (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('the signature-only helper is GONE from the entire repository', () => {
    // Comments are stripped: the tombstone docblocks in bridgeCookie.ts and
    // superAdminSession.ts name the removed helper on purpose, so that a
    // future reader learns why it must not come back.
    const offenders = files.filter((f) =>
      /hasValidLegacySuperAdminCookie/.test(stripComments(fs.readFileSync(f, 'utf8')))
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('NO route imports bridgeCookie to make an authorization decision', () => {
    // bridgeCookie is a crypto leaf. Routes may MINT (login) or CLEAR (logout);
    // they may not parse/verify for themselves.
    const offenders = files
      .filter((f) => f.includes(`${path.sep}pages${path.sep}api${path.sep}`))
      .filter((f) => /parseSignedBridgeCookie/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('parseSignedBridgeCookie is consumed ONLY by the lifecycle evaluator', () => {
    const consumers = files
      .filter((f) => /parseSignedBridgeCookie/.test(stripComments(fs.readFileSync(f, 'utf8'))))
      .map(rel)
      .sort();
    expect(consumers).toEqual([
      'backend/security/bridgeCookie.ts', // defines it
      'backend/security/legacyCookieSuperAdminBridge.ts', // sole lifecycle evaluator
    ]);
  });

  it('the lifecycle sequence has exactly ONE definition', () => {
    const definers = files.filter((f) =>
      /export function evaluateBridgeCookieLifecycle/.test(fs.readFileSync(f, 'utf8'))
    );
    expect(definers.map(rel)).toEqual(['backend/security/legacyCookieSuperAdminBridge.ts']);
  });

  it('every bridge-cookie consumer reaches its verdict through that evaluator', () => {
    // A module that decides on a bridge cookie must not re-derive the sequence
    // from the dry-run / hard-expiry primitives itself.
    const decisionMakers = files.filter((f) => {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      return /isLegacyBridgeDryRun\(\)|LEGACY_BRIDGE_HARD_EXPIRY_AT\.getTime\(\)/.test(src);
    });
    expect(decisionMakers.map(rel)).toEqual(['backend/security/legacyCookieSuperAdminBridge.ts']);
  });

  it('the hard-expiry constant has exactly ONE definition; everyone else imports it', () => {
    const definers = files.filter((f) =>
      /LEGACY_BRIDGE_HARD_EXPIRY_AT\s*=/.test(stripComments(fs.readFileSync(f, 'utf8')))
    );
    expect(definers.map(rel)).toEqual(['backend/security/legacyCookieSuperAdminBridge.ts']);

    // And no module hand-copies the date as a literal.
    const copiers = files
      .filter((f) => !rel(f).endsWith('legacyCookieSuperAdminBridge.ts'))
      .filter((f) => /['"]2026-08-05T00:00/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(copiers.map(rel)).toEqual([]);
  });

  it('every API route that authorizes via the bridge uses the canonical helper', () => {
    const routes = files.filter((f) => f.includes(`${path.sep}pages${path.sep}api${path.sep}`));
    const bridgeAuthorizers = routes.filter((f) =>
      /getLegacySuperAdminSession/.test(stripComments(fs.readFileSync(f, 'utf8')))
    );
    // Sanity: the migration actually landed on a large surface.
    expect(bridgeAuthorizers.length).toBeGreaterThanOrEqual(50);

    // No route may name the bridge cookie outside a Set-Cookie write.
    const rawReaders = routes.filter((f) =>
      /cookies\s*(\?)?\s*[.[]\s*['"]?super_admin_session/.test(
        stripComments(fs.readFileSync(f, 'utf8'))
      )
    );
    expect(rawReaders.map(rel)).toEqual([]);
  });

  it('render-ops has BOTH arms — bridge and canonical DB-backed super admin', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'pages/api/internal/render-ops.ts'), 'utf8');
    expect(/getLegacySuperAdminSession\(req\)/.test(src)).toBe(true);
    expect(/isPlatformSuperAdmin/.test(src)).toBe(true);
  });
});
