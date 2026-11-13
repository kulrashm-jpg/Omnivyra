/**
 * Owner ruling (2026-11-13, PRE-LAUNCH, safety) — the legacy "Content
 * Architect" privilege path is REMOVED:
 *
 *   - the shared env-credential login route (/api/super-admin/content-architect-login);
 *   - the signed `content_architect_session` cookie and every reader of it;
 *   - the fake principal (userId 'content_architect') that was treated as
 *     COMPANY_ADMIN of EVERY company, and every special case recognising it.
 *
 * KEPT on purpose: the capability constants CONTENT_ARCHITECT_READ /
 * CONTENT_ARCHITECT_WRITE and the CONTENT_ARCHITECT role name in the capability
 * registry — a proper, named-account feature will reuse them later.
 *
 * Part 1 is a static scan of production code (with a positive control proving
 * the scanner actually reads files). Part 2 is behavioural: the cookie and the
 * principal id confer nothing on the two decision seams that used to honour
 * them (resolveCompanyAccess, enforceRole).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_DIRS = ['pages', 'backend', 'lib', 'components', 'hooks', 'shared', 'utils'];
const SCAN_FILES = ['proxy.ts'];
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (e.isDirectory()) {
      // Tests (and test helpers) are not production code.
      if (rel === 'backend/tests' || rel.startsWith('backend/tests/') || e.name === '__tests__') continue;
      walk(full, out);
    } else if (EXT.test(e.name) && !/\.test\.(ts|tsx|js)$/.test(e.name)) {
      out.push(rel);
    }
  }
}

function productionFiles(): string[] {
  const out: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), out);
  for (const f of SCAN_FILES) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  return out;
}

type Hit = { file: string; line: number; text: string };

function scan(files: string[], pattern: RegExp, allowLine?: (line: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (pattern.test(text) && !(allowLine && allowLine(text))) {
        hits.push({ file, line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

describe('legacy Content Architect path — static guard over production code', () => {
  const files = productionFiles();

  it('positive control: the scanner reads production files (finds the KEPT capability constants)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('backend/security/capabilityRegistry.ts');
    const kept = scan(files, /\bCONTENT_ARCHITECT_READ\b/);
    expect(kept.map((h) => h.file)).toEqual(
      expect.arrayContaining([
        'shared/contracts/security/SecurityCapabilities.ts',
        'backend/security/capabilityRegistry.ts',
      ]),
    );
  });

  it("no production file mints or recognises the fake principal id 'content_architect'", () => {
    expect(scan(files, /(['"`])content_architect\1/)).toEqual([]);
  });

  it('no production file reads the content_architect_session cookie', () => {
    // The ONLY permitted occurrence is the Set-Cookie value that CLEARS a stale
    // browser cookie on super-admin login/logout (`'content_architect_session=',`).
    const clearOnly = (line: string) => /^\s*'content_architect_session=',\s*$/.test(line);
    expect(scan(files, /content_architect_session/, clearOnly)).toEqual([]);
  });

  it('isContentArchitectSession / checkContentArchitectAccess no longer exist anywhere in production code', () => {
    expect(scan(files, /\bisContentArchitectSession\b|\bcheckContentArchitectAccess\b/)).toEqual([]);
  });

  it('the shared-credential login route and its session service are gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'pages/api/super-admin/content-architect-login.ts'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'backend/services/contentArchitectSecurityService.ts'))).toBe(false);
    expect(scan(files, /content-architect-login/)).toEqual([]);
    expect(scan(files, /CONTENT_ARCHITECT_(USERNAME|PASSWORD|PRIMARY_USER_ID)/)).toEqual([]);
  });

  it('the website-edit exemption names ONLY SUPER_ADMIN', () => {
    const src = fs.readFileSync(path.join(ROOT, 'pages/api/company-profile/index.ts'), 'utf8');
    const m = src.match(/const canEditCanonicalWebsite\s*=\s*([^;]+);/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("'SUPER_ADMIN'");
    expect(m![1]).not.toContain('CONTENT_ARCHITECT');
  });
});

/* ── Behaviour ───────────────────────────────────────────────────────────── */

let authResult: { user: { id: string } | null; error: string | null } = { user: null, error: 'MISSING_AUTH' };
let userContext: Record<string, unknown> = {};

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => authResult),
}));

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => userContext),
}));

jest.mock('../../db/writeOwner', () => {
  const builder = (): any => {
    const b: any = {};
    for (const op of ['select', 'eq', 'in', 'order', 'limit', 'is', 'neq']) b[op] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (r: any, j: any) => Promise.resolve({ data: [], error: null }).then(r, j);
    return b;
  };
  return { ownedDbTable: () => builder(), ownedDbRpc: async () => ({ data: null, error: null }) };
});

jest.mock('../../services/rbacPrimitives', () => {
  const actual = jest.requireActual('../../services/rbacPrimitives');
  return { ...actual, getCompanyRoleIncludingInvited: jest.fn(async () => null) };
});

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}

function withSignedArchitectCookie(fn: (cookieValue: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const savedSecret = process.env.BRIDGE_COOKIE_SECRET;
    const savedDryRun = process.env.LEGACY_BRIDGE_DRY_RUN;
    process.env.BRIDGE_COOKIE_SECRET = 'ca-legacy-removed-test-secret-thirty-two+';
    delete process.env.LEGACY_BRIDGE_DRY_RUN;
    const { mintSignedBridgeCookieValue } = require('../../security/bridgeCookie') as
      typeof import('../../security/bridgeCookie');
    // Freeze the clock BEFORE the old bridge hard-expiry (2026-08-05), so the
    // cookie is one the removed code WOULD have honoured. Only removal of the
    // reader — not the calendar — can make these assertions pass.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-01T00:00:00Z'));
    try {
      await fn(mintSignedBridgeCookieValue());
    } finally {
      nowSpy.mockRestore();
      if (savedSecret === undefined) delete process.env.BRIDGE_COOKIE_SECRET;
      else process.env.BRIDGE_COOKIE_SECRET = savedSecret;
      if (savedDryRun === undefined) delete process.env.LEGACY_BRIDGE_DRY_RUN;
      else process.env.LEGACY_BRIDGE_DRY_RUN = savedDryRun;
    }
  };
}

describe('legacy Content Architect path — behaviour', () => {
  beforeEach(() => {
    authResult = { user: null, error: 'MISSING_AUTH' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it(
    'resolveCompanyAccess: a validly SIGNED content_architect_session cookie with no auth gets NO company access (401)',
    withSignedArchitectCookie(async (cookieValue) => {
      const { resolveCompanyAccess } = require('../../services/contentArchitectService') as
        typeof import('../../services/contentArchitectService');
      const req: any = {
        method: 'GET',
        url: '/api/company-profile',
        query: {},
        body: {},
        headers: { cookie: `content_architect_session=${cookieValue}` },
        cookies: { content_architect_session: cookieValue },
      };
      const res = mockRes();
      const access = await resolveCompanyAccess(req, res, '11111111-1111-4111-8111-111111111111');
      expect(access).toBeNull();
      expect([401, 403]).toContain(res.statusCode);
    }),
  );

  it(
    'resolveCompanyAccess: the cookie cannot rescue an authenticated NON-member (403, no CONTENT_ARCHITECT role)',
    withSignedArchitectCookie(async (cookieValue) => {
      authResult = { user: { id: '22222222-2222-4222-8222-222222222222' }, error: null };
      const { resolveCompanyAccess } = require('../../services/contentArchitectService') as
        typeof import('../../services/contentArchitectService');
      const req: any = {
        method: 'GET',
        url: '/api/company-profile',
        query: {},
        body: {},
        headers: { cookie: `content_architect_session=${cookieValue}` },
        cookies: { content_architect_session: cookieValue },
      };
      const res = mockRes();
      const access = await resolveCompanyAccess(req, res, '11111111-1111-4111-8111-111111111111');
      expect(access).toBeNull();
      expect(res.statusCode).toBe(403);
    }),
  );

  it("enforceRole: a principal carrying the legacy id 'content_architect' is NOT granted COMPANY_ADMIN", async () => {
    userContext = {
      userId: 'content_architect',
      role: 'admin',
      companyIds: [],
      defaultCompanyId: '',
      authenticated: true,
    };
    const { enforceRole, Role } = require('../../services/rbacService') as
      typeof import('../../services/rbacService');
    const res = mockRes();
    const result = await enforceRole({
      req: { url: '/api/x', headers: {}, query: {}, body: {} } as any,
      res,
      companyId: '11111111-1111-4111-8111-111111111111',
      allowedRoles: [Role.COMPANY_ADMIN],
    });
    expect(result).toBeNull();
    expect(res.statusCode).toBe(403);
  });
});
