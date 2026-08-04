/**
 * SEC-001B — Final legacy super-admin cookie elimination.
 *
 * BACKGROUND
 * Phase 1 issued a static `super_admin_session=1`. Phase 2 replaced issuance
 * with an HMAC-signed value, but ~31 production routes kept testing
 * `req.cookies?.super_admin_session === '1'` inline. After Phase 2 that
 * comparison is false for EVERY legitimately issued cookie and true only for a
 * hand-set `=1` — i.e. it authorized precisely the forged case and no real
 * operator. SEC-001B replaced all of them with a signature-verifying helper.
 *
 * SEC-001C then unified the two bridge entry points: the signature-only helper
 * (`hasValidLegacySuperAdminCookie`) was DELETED and every route moved to the
 * lifecycle-aware `superAdminSession.getLegacySuperAdminSession`. This file
 * therefore now pins:
 *   1. the CRYPTO matrix of the surviving primitive `parseSignedBridgeCookie`,
 *   2. the repo-wide source ratchets (no raw comparison anywhere, no HMAC of
 *      the bridge cookie outside `bridgeCookie.ts`).
 * The lifecycle guarantees are pinned by sec001cBridgeUnification.test.ts.
 */
import fs from 'fs';
import path from 'path';

process.env.BRIDGE_COOKIE_SECRET =
  process.env.BRIDGE_COOKIE_SECRET || 'sec001b-test-bridge-secret-at-least-32-chars-long';

import {
  parseSignedBridgeCookie,
  mintSignedBridgeCookieValue,
  BRIDGE_COOKIE_MAX_AGE_SECONDS,
} from '../../security/bridgeCookie';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Does the crypto layer accept this raw cookie value? */
function accepts(value: string | null | undefined): boolean {
  return parseSignedBridgeCookie(value ?? null).ok === true;
}

/** Recursively collect production .ts/.tsx files (excludes tests + node_modules). */
function collectSourceFiles(dirs: string[]): string[] {
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
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  for (const d of dirs) walk(path.join(REPO_ROOT, d));
  return out;
}

/** Strip block + line comments so invariants test CODE, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// ── 1. Crypto matrix of the surviving primitive ────────────────────────
describe('SEC-001B — parseSignedBridgeCookie accept/reject matrix', () => {
  it('REJECTS the forged Phase-1 static value "1" (the vulnerability itself)', () => {
    expect(accepts('1')).toBe(false);
    expect(parseSignedBridgeCookie('1')).toEqual({ ok: false, reason: 'legacy_format' });
  });

  it('ACCEPTS a freshly minted signed cookie', () => {
    expect(accepts(mintSignedBridgeCookieValue())).toBe(true);
  });

  it('REJECTS absent / empty cookie', () => {
    expect(accepts(undefined)).toBe(false);
    expect(accepts(null)).toBe(false);
    expect(accepts('')).toBe(false);
  });

  it('REJECTS malformed values (no signature separator)', () => {
    for (const v of ['abc', 'true', 'yes', '.', '.sig', 'payload.']) {
      expect(accepts(v)).toBe(false);
    }
  });

  it('REJECTS a tampered payload under a valid-looking signature', () => {
    const good = mintSignedBridgeCookieValue();
    const [payload, sig] = good.split('.');
    const forgedPayload = Buffer.from(
      `${Math.floor(Date.now() / 1000)}:deadbeefdeadbeefdeadbeef`,
      'utf8'
    ).toString('base64url');
    expect(forgedPayload).not.toBe(payload);
    expect(accepts(`${forgedPayload}.${sig}`)).toBe(false);
  });

  it('REJECTS a tampered signature under a valid payload', () => {
    const [payload] = mintSignedBridgeCookieValue().split('.');
    expect(accepts(`${payload}.notarealsignature`)).toBe(false);
  });

  it('REJECTS a cookie signed with a DIFFERENT secret', () => {
    const original = process.env.BRIDGE_COOKIE_SECRET;
    process.env.BRIDGE_COOKIE_SECRET = 'an-entirely-different-secret-also-32-chars-plus';
    let attackerCookie: string;
    try {
      attackerCookie = mintSignedBridgeCookieValue();
    } finally {
      process.env.BRIDGE_COOKIE_SECRET = original;
    }
    expect(accepts(attackerCookie)).toBe(false);
  });

  it('REJECTS a cookie older than the server-enforced max age', () => {
    const spy = jest.spyOn(Date, 'now');
    const realNow = Date.now();
    spy.mockReturnValue(realNow);
    const cookie = mintSignedBridgeCookieValue();
    expect(accepts(cookie)).toBe(true);
    // Advance past the server-side max age; browser expiry is irrelevant.
    spy.mockReturnValue(realNow + (BRIDGE_COOKIE_MAX_AGE_SECONDS + 60) * 1000);
    expect(accepts(cookie)).toBe(false);
    spy.mockRestore();
  });

  it('FAILS CLOSED when no signing secret is configured', () => {
    const cookie = mintSignedBridgeCookieValue();
    const bridge = process.env.BRIDGE_COOKIE_SECRET;
    const session = process.env.SESSION_COOKIE_SECRET;
    delete process.env.BRIDGE_COOKIE_SECRET;
    delete process.env.SESSION_COOKIE_SECRET;
    try {
      expect(accepts(cookie)).toBe(false);
      expect(accepts('1')).toBe(false);
    } finally {
      if (bridge !== undefined) process.env.BRIDGE_COOKIE_SECRET = bridge;
      if (session !== undefined) process.env.SESSION_COOKIE_SECRET = session;
    }
  });
});

// ── 2. Repo-wide source invariants (the ratchet) ───────────────────────
describe('SEC-001B — no production code performs raw bridge-cookie authorization', () => {
  const PROD_DIRS = ['pages', 'backend', 'lib', 'components'];
  const files = collectSourceFiles(PROD_DIRS);

  it('collected a meaningful set of production files (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('ZERO production files compare the bridge cookie to a literal', () => {
    const offenders = files.filter((f) =>
      /cookies\s*(\?)?\s*[.[][^\n=]*super_admin_session[^\n=]*(===|==|!==|!=)\s*['"]/.test(
        stripComments(fs.readFileSync(f, 'utf8'))
      )
    );
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it('ZERO production files compare the content-architect cookie to a literal', () => {
    const offenders = files.filter((f) =>
      /cookies\s*(\?)?\s*[.[][^\n=]*content_architect_session[^\n=]*(===|==|!==|!=)\s*['"]/.test(
        stripComments(fs.readFileSync(f, 'utf8'))
      )
    );
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it('NO route verifies the BRIDGE cookie locally — that HMAC lives only in bridgeCookie.ts', () => {
    // Scoped deliberately: routes legitimately use HMAC for unrelated secrets
    // (Meta webhook signatures, invitation tokens, bootstrap-token compares).
    // What SEC-001B forbids is a route hand-rolling verification of the BRIDGE
    // cookie instead of delegating to the canonical primitive — i.e. a file
    // that both names the bridge cookie and does its own crypto.
    const offenders = files
      .filter((f) => f.includes(`${path.sep}pages${path.sep}api${path.sep}`))
      .filter((f) => {
        const src = stripComments(fs.readFileSync(f, 'utf8'));
        return (
          /super_admin_session|BRIDGE_COOKIE_NAME/.test(src) &&
          /createHmac|timingSafeEqual/.test(src)
        );
      });
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it('bridgeCookie.ts is the ONLY module that HMACs the bridge cookie', () => {
    const hmacBridge = files.filter((f) => {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      return /BRIDGE_COOKIE_NAME|super_admin_session/.test(src) && /createHmac/.test(src);
    });
    expect(hmacBridge.map((f) => path.relative(REPO_ROOT, f).replace(/\\/g, '/'))).toEqual([
      'backend/security/bridgeCookie.ts',
    ]);
  });

  it('every route reading the raw bridge cookie name does so via a canonical helper', () => {
    const offenders: string[] = [];
    for (const f of files.filter((x) => x.includes(`${path.sep}pages${path.sep}api${path.sep}`))) {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      // Reading `req.cookies.super_admin_session` directly in a route is the
      // pattern SEC-001B removed. Set-Cookie strings (issuance / logout) are
      // writes, not authorization, and do not match this.
      if (/cookies\s*(\?)?\s*[.[]\s*['"]?super_admin_session/.test(src)) {
        offenders.push(path.relative(REPO_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
