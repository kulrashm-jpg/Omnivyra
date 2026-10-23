/**
 * SEC-91A (STEP 3AH-91) — A1: per-HTTP-method authentication gaps.
 *
 * The ROUTE-AUTH-001 gate is per FILE: a route passes when ANY branch invokes an
 * approved primitive. These routes had one branch that did and one that did not
 * (SEC-F's per-method gate R1-METHOD reports them as F1-01..F1-03):
 *
 *   F1-01 accounts/[platform]        POST  unauthenticated mock "connect", logged the OAuth `code`
 *   F1-02 track/angle-industry-matrix GET  unauthenticated read of a platform-wide aggregate
 *   F1-03 track/angle-industry-matrix POST any member of ANY company wrote the GLOBAL aggregate
 *
 * Only the database and identity provider are faked; the guard chain is real.
 */
import { upsertAppendsBlindly, seed, invoke, rows, writeCalls, completedWrites, failTable, CO_A } from '../helpers/routeAuthHarness';
import { bearer, USER_EXSUPER } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../services/platformIntelligenceService', () => ({
  getPlatformRules: async (p: string) => ({ platform: { canonical_key: p } }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const accountsPlatform = require('../../../pages/api/accounts/[platform]').default;
const angleMatrix = require('../../../pages/api/track/angle-industry-matrix').default;
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  seed({
    user_company_roles: [{ user_id: USER_EXSUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: 'inactive' }],
    angle_industry_matrix: [
      { industry: 'saas', angle_type: 'analytical', post_count: 5, score_sum: 350, avg_score: 70, prior_rank: 1, prior_note: 'n' },
      { industry: 'saas', angle_type: 'contrarian', post_count: 5, score_sum: 300, avg_score: 60, prior_rank: 2, prior_note: 'n' },
    ],
  });
  // UPSERT MODEL, declared explicitly rather than inherited: this suite
  // asserts that the operator-curation aggregate write reaches its sink,
  // not conflict resolution. The append model performs no arbiter
  // resolution, so nothing here may be read as evidence about row
  // identity, uniqueness or tenancy through an upsert.
  upsertAppendsBlindly('angle_industry_matrix', 'that the operator-curation aggregate write reaches its sink');
});

describe('F1-01 POST /api/accounts/[platform] (mock connect)', () => {
  it('unauthenticated → 401 (was 200 for anyone)', async () => {
    const r = await invoke(accountsPlatform, { method: 'POST', query: { platform: 'linkedin' }, body: { code: 'oauth-code-secret' } });
    expect(r.status).toBe(401);
  });

  it('never logs the caller-supplied OAuth code', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await invoke(accountsPlatform, { method: 'POST', query: { platform: 'linkedin' }, body: { code: 'oauth-code-secret' }, headers: bearer('A') });
      expect(log.mock.calls.flat().join(' ')).not.toContain('oauth-code-secret');
    } finally {
      log.mockRestore();
    }
  });

  it('authenticated → 200, the mock response is unchanged', async () => {
    const r = await invoke(accountsPlatform, { method: 'POST', query: { platform: 'linkedin' }, body: { code: 'c' }, headers: bearer('A') });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  it('sibling GET still requires auth → 401', async () => {
    const r = await invoke(accountsPlatform, { method: 'GET', query: { platform: 'linkedin' } });
    expect(r.status).toBe(401);
  });
});

describe('F1-02 GET /api/track/angle-industry-matrix', () => {
  it('unauthenticated → 401, table never read (was 200 for anyone)', async () => {
    const r = await invoke(angleMatrix, { method: 'GET', query: { industry: 'saas' } });
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty('angles');
  });

  it('any authenticated user → 200 with the rankings', async () => {
    const r = await invoke(angleMatrix, { method: 'GET', query: { industry: 'saas' }, headers: bearer('B') });
    expect(r.status).toBe(200);
    expect(r.body.angles).toHaveLength(2);
  });
});

describe('F1-03 POST /api/track/angle-industry-matrix (global aggregate write)', () => {
  const body = { company_id: CO_A, industry: 'saas', angle_type: 'contrarian', content_score: 100 };
  const contrarian = () => rows('angle_industry_matrix').find((r) => r.angle_type === 'contrarian')!;

  it('unauthenticated → 401, nothing written', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body });
    expect(r.status).toBe(401);
    expect(writeCalls(['angle_industry_matrix'])).toEqual([]);
  });

  it('THE EXPLOIT: an admin of their own company cannot write the shared aggregate → 403, nothing written', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('A') });
    expect(r.status).toBe(403);
    expect(writeCalls(['angle_industry_matrix'])).toEqual([]);
    expect(contrarian().post_count).toBe(5);
  });

  it('a deactivated super admin cannot either → 403', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('EXSUPER') });
    expect(r.status).toBe(403);
    expect(writeCalls(['angle_industry_matrix'])).toEqual([]);
  });

  // "the write is issued", not "incremented": angle_industry_matrix is modelled
  // with the APPEND upsert model, so the harness does not merge and no counter
  // in the modelled table moves. An earlier title said "aggregate incremented",
  // which claimed a resulting row state this test does not assert and the model
  // does not produce.
  it('an active platform super admin (operator curation) → 200, the aggregate write is issued', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('SUPER') });
    expect(r.status).toBe(200);
    // ON completedWrites(), NOT writeCalls(). writeCalls() counts a statement
    // the harness REFUSED as a configuration defect, and on a GRANT path a
    // refused statement is indistinguishable from a real write to every
    // accessor except this one: its payload is readable and call ordering is
    // preserved, so presence, payload and sequence assertions all pass over a
    // write that never ran. completedWrites() also excludes a statement the
    // model ERRORED. See the four outcomes in the harness.
    expect(completedWrites(['angle_industry_matrix'])).toHaveLength(1);
    // The success contract itself, pinned so the OD-1 fix cannot have changed it.
    expect(r.body).toEqual({ ok: true });
  });

  // ── OD-1: the route must not report success when the database fails ───────
  //
  // THE DEFECT. Neither statement's error was read. The upsert's result was
  // discarded entirely, so the route answered 200 { ok: true } with nothing
  // persisted; and the SELECT's error was discarded too, which was worse —
  // `existing` became undefined, indistinguishable from "no row yet", so the
  // upsert OVERWROTE the running aggregate with post_count 1 and this one
  // request's score. A transient read failure destroyed accumulated data and
  // still answered 200.
  describe('a failed database statement is never reported as success (OD-1)', () => {
    let errSpy: jest.SpyInstance;
    beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => { errSpy.mockRestore(); });

    it('a failed WRITE → 500, and no completed write', async () => {
      failTable('angle_industry_matrix', 'upsert');
      const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('SUPER') });
      expect(r.status).toBe(500);
      expect(r.body).not.toEqual({ ok: true });
      // attempted, but it did not complete and stored nothing
      expect(writeCalls(['angle_industry_matrix'])).toHaveLength(1);
      expect(completedWrites(['angle_industry_matrix'])).toHaveLength(0);
    });

    it('a failed READ → 500 BEFORE any write, so the aggregate cannot be clobbered', async () => {
      // The destructive half. Without the read-error check the route would
      // compute post_count 1 from an undefined `existing` and upsert that over
      // a row holding 5. Asserting zero write attempts is what proves the
      // clobber is unreachable, not merely corrected afterwards.
      failTable('angle_industry_matrix', 'select');
      const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('SUPER') });
      expect(r.status).toBe(500);
      expect(r.body).not.toEqual({ ok: true });
      expect(writeCalls(['angle_industry_matrix'])).toHaveLength(0);
      expect(contrarian().post_count).toBe(5);
      expect(contrarian().score_sum).toBe(300);
    });

    it('the error response discloses NO database detail', async () => {
      failTable('angle_industry_matrix', 'upsert');
      const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('SUPER') });
      const serialised = JSON.stringify(r.body);
      expect(serialised).not.toContain('XX000');            // the sql state
      expect(serialised).not.toContain('forced failure');   // the driver message
      expect(serialised).not.toContain('angle_industry_matrix'); // the table name
      expect(r.body).toEqual({ error: 'Failed to update angle aggregate' });
    });

    it('the error LOG carries the code and message only — never the payload or the error object', async () => {
      // Requirement: logging must not expose sensitive payloads. A PostgREST
      // error also carries `details` and `hint`, which can echo row values, so
      // the whole object must not be logged either.
      const canary = 'CANARY-INDUSTRY-VALUE';
      failTable('angle_industry_matrix', 'upsert');
      const r = await invoke(angleMatrix, {
        method: 'POST',
        body: { ...body, industry: canary, content_score: 73 },
        headers: bearer('SUPER'),
      });
      expect(r.status).toBe(500);
      expect(errSpy).toHaveBeenCalledTimes(1);
      const args = errSpy.mock.calls[0];
      // exactly three primitives: a prefix, the code, the message
      expect(args).toHaveLength(3);
      expect(args[0]).toBe('[angle-industry-matrix] aggregate write failed:');
      expect(args[1]).toBe('XX000');
      expect(typeof args[2]).toBe('string');
      // nothing of the caller's payload, and no object that could carry details/hint
      const logged = args.map((a: unknown) => String(a)).join(' | ');
      expect(logged).not.toContain(canary);
      expect(logged).not.toContain('73');
      expect(args.some((a: unknown) => a !== null && typeof a === 'object')).toBe(false);
    });
  });
});

// ── OD-6 (Phase 82) ── mechanical adoption of the harness-configuration detector.
//
// A refusal means the harness declined to MODEL a statement, so nothing ran.
// On a DENY path writeCalls() counts it, so the canonical zero-write assertion
// fails and the refusal surfaces. On a GRANT path it does not: a refused
// statement is indistinguishable from a real write to presence, payload and
// ordering assertions, and a route that catches the throw makes it silent.
//
// This is the established detector, already proven in three suites. Adopting it
// here fails the test instead of letting a swallowed refusal read as
// enforcement. It is additive: no existing hook, assertion or declaration is
// changed, and the helper is required lazily so no import statement is touched.
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../helpers/routeAuthHarness').assertNoHarnessConfigurationError();
});
