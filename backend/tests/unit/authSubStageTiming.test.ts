/**
 * auth sub-stage attribution.
 *
 * `auth` was the dominant variable stage of /api/company-profile?mode=list
 * (2,315ms against a ~280ms calm floor) but contains two distinct IO
 * boundaries: token validation (GoTrue, 30s-cached, single-flighted) and the
 * users-row lookup. These pin the instrumentation that separates them.
 *
 * The resolver takes an optional TimingSink rather than `res` so it stays
 * transport-free; absent sink means zero overhead and no behaviour change.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RESOLVER = read('backend/services/authResolver.ts');
const FACADE = read('backend/services/supabaseAuthService.ts');
const ROUTE = read('pages/api/company-profile/index.ts');

describe('auth sub-stages are instrumented', () => {
  it('auth_validate wraps token validation only', () => {
    expect(RESOLVER).toContain("timeInto(timing, 'auth_validate', () => validateTokenWithSupabase(token))");
  });

  it('auth_user wraps the users-row lookup only', () => {
    expect(RESOLVER).toContain("timeInto(timing, 'auth_user', () => resolveUserRow(identity.supabaseUid, identity.email))");
  });

  it('each label is wrapped exactly once', () => {
    ['auth_validate', 'auth_user'].forEach((l) => {
      expect(RESOLVER.split(`timeInto(timing, '${l}'`).length - 1).toBe(1);
    });
  });

  it('the sink is optional, so existing callers are unaffected', () => {
    expect(RESOLVER).toContain('timing?: TimingSink,');
    expect(FACADE).toContain('timing?: TimingSink,');
    expect(FACADE).toContain('resolveAuthenticatedUser(req, timing)');
  });
});

describe('the outer stages survive', () => {
  it('the route still emits every existing label', () => {
    ['auth', 'user', 'roles', 'companies', 'fallback'].forEach((l) => {
      expect(ROUTE).toContain(`timeStage(res, '${l}',`);
    });
    expect(ROUTE.split("appendServerTiming(res, 'total'").length - 1).toBe(2);
  });

  it('auth remains the outer boundary and drains the sink', () => {
    expect(ROUTE).toContain("timeStage(res, 'auth', () => getSupabaseUserFromRequest(req, authTiming))");
    expect(ROUTE).toContain('flushTimingSink(res, authTiming);');
  });
});

describe('no behaviour was changed', () => {
  it('execution order in the resolver is unchanged', () => {
    const v = RESOLVER.indexOf("'auth_validate'");
    const u = RESOLVER.indexOf("'auth_user'");
    const email = RESOLVER.indexOf("error: 'NO_EMAIL'");
    expect(v).toBeGreaterThan(-1);
    expect(email).toBeGreaterThan(v);   // email check still between the two
    expect(u).toBeGreaterThan(email);
  });

  it('auth failure semantics are untouched', () => {
    ["error: 'NO_TOKEN'", "error: 'INVALID_TOKEN'", "error: 'NO_EMAIL'",
     "error: 'USER_NOT_FOUND'", "error: 'ACCOUNT_DELETED'", "error: 'ACCOUNT_SUSPENDED'",
     "error: 'SESSION_REVOKED'"].forEach((e) => expect(RESOLVER).toContain(e));
  });

  it('caching, single-flight and the GoTrue timeout are unchanged', () => {
    expect(RESOLVER).toContain('getCachedValidation(token)');
    expect(RESOLVER).toContain('singleFlight(`auth:getUser:${token}`');
    expect(RESOLVER).toContain('SUPABASE_AUTH_TIMEOUT_MS');
    expect(RESOLVER).toContain('setCachedValidation(token, identity)');
  });

  it('no database query or network call was added', () => {
    // timeInto only wraps; the resolver's IO sites are unchanged in number.
    // Two pre-existing sites: the resolver path (now wrapped) and the exported
    // validateAuthToken wrapper. The wrap added no call of its own.
    expect(RESOLVER.split('validateTokenWithSupabase(token)').length - 1).toBe(2);
    expect(RESOLVER.split('resolveUserRow(identity.supabaseUid, identity.email)').length - 1).toBe(1);
    // Two pre-existing users sites in the route: the `user` stage select and
    // the conditional active_company_id sync. Neither was added here.
    expect(ROUTE.split("from('users')").length - 1).toBe(2);
  });
});
