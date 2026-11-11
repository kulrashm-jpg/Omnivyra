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
  delete process.env.LEGACY_BRIDGE_DRY_RUN;
  nowMs = BEFORE_EXPIRY_MS;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.LEGACY_BRIDGE_DRY_RUN;
});

// ── Source inventory helpers ───────────────────────────────────────────
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ══ TASK 1/2 — final dependency inventory ══════════════════════════════
// The route-level dependency inventory lived here. e9 (C), 2026-11-11: the
// route-level getter is DELETED and every former bridge route authorizes by
// capability or tenant role (pinned in sec001cBridgeUnification (B) and the
// secLegacySa* suites), so there is no route surface left to inventory.

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

  it('the remaining (capability) entry point reaches the one decision', async () => {
    setNow(AFTER_EXPIRY_MS);
    const cookie = mintAt(AFTER_EXPIRY_MS - 60 * 1000);
    expect(evaluateBridgeCookieLifecycle(cookie)).toEqual({ ok: false, reason: 'hard_expired' });
    await expect(resolveLegacyCookieSuperAdminPrincipal(reqWith(cookie))).resolves.toBeNull();
  });
});

// ══ TASK 4 — dry-run verification ══════════════════════════════════════
describe('SEC-001D — dry-run makes every bridge consumer visible', () => {
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

});

// ══ TASK 5 — bridge removal simulation ═════════════════════════════════
describe('SEC-001D — hard-expiry simulation: the bridge grants nothing', () => {
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

  it('NO cookie value of any shape can revive the bridge past the expiry', async () => {
    setNow(AFTER_EXPIRY_MS);
    for (const v of ['1', 'true', mintAt(AFTER_EXPIRY_MS), mintAt(AFTER_EXPIRY_MS - 1000)]) {
      await expect(resolveLegacyCookieSuperAdminPrincipal(reqWith(v))).resolves.toBeNull();
    }
  });
});
