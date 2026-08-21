/**
 * /api/feature-completion — Server-Timing attribution.
 *
 * Measured at 11,288ms in the Command Center readiness wave — the slowest of
 * its 17 requests and, until now, entirely unattributable: the handler carried
 * no Server-Timing at all. These pin the instrumentation wiring; they assert
 * presence, naming and exit coverage, never wall-clock values.
 *
 * Observability only — no behaviour is changed, and none is asserted to change.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../pages/api/feature-completion.ts'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Phase 31: the 'features' stage was removed. getFeatureCompletionSummary already
// calls getFeatureCompletionStatus internally and returns those rows on .features,
// so the separate stage issued a byte-identical duplicate query against
// feature_completion on the response critical path.
const STAGES = ['auth', 'roles', 'sync', 'summary'] as const;

/**
 * Phase 37 — the `auth` stage is decomposed into its two IO operations.
 *
 * auth_validate (GoTrue db.auth.getUser) and auth_user (the users row keyed on
 * the validated supabaseUid) are already wrapped in timeInto() inside
 * resolveAuthenticatedUser. They only reach Server-Timing when a TimingSink is
 * supplied; without one, timeInto is a no-op and the stage stays opaque. These
 * two are emitted through the sink, NOT through timeStage, so they are asserted
 * separately from STAGES.
 */
describe('A2 — auth sub-stage observability (Phase 37)', () => {
  it('MUTATION GUARD: the timing sink is supplied to the resolver', () => {
    // Dropping the second argument silently restores the opaque auth stage —
    // no test would otherwise fail, and 46.7% of the request becomes
    // unattributable again.
    expect(CODE).toContain('getSupabaseUserFromRequest(req, authTiming)');
    expect(CODE).not.toMatch(/getSupabaseUserFromRequest\(req\)/);
  });

  it('creates and flushes the sink using the shared helper', () => {
    expect(CODE).toContain('const authTiming = createTimingSink();');
    expect(CODE).toContain('flushTimingSink(res, authTiming);');
    expect(CODE).toContain("from '../../lib/platform/serverTiming'");
  });

  it('the sink is flushed after the stage it measures', () => {
    expect(CODE.indexOf('const authTiming = createTimingSink();'))
      .toBeLessThan(CODE.indexOf("timeStage(res, 'auth'"));
    expect(CODE.indexOf("timeStage(res, 'auth'"))
      .toBeLessThan(CODE.indexOf('flushTimingSink(res, authTiming);'));
  });

  it('auth_validate and auth_user are the resolver-side stage names', () => {
    // Pinned at the source of truth so a rename there cannot silently drop
    // these from this endpoint's Server-Timing.
    const RESOLVER = fs.readFileSync(
      path.resolve(__dirname, '../../../backend/services/authResolver.ts'), 'utf8');
    expect(RESOLVER).toContain("timeInto(timing, 'auth_validate'");
    expect(RESOLVER).toContain("timeInto(timing, 'auth_user'");
  });

  it('no new timing mechanism was introduced', () => {
    expect(CODE.split('createTimingSink(').length - 1).toBe(1);
    expect(CODE.split('flushTimingSink(').length - 1).toBe(1);
  });
});

describe('A — real stages are instrumented', () => {
  it.each(STAGES)('wraps the %s stage', (stage) => {
    expect(CODE).toContain(`timeStage(res, '${stage}',`);
  });

  it('wraps the calls that already existed, not new ones', () => {
    expect(CODE).toContain("timeStage(res, 'auth', () => getSupabaseUserFromRequest(req, authTiming))");
    expect(CODE).toContain("timeStage(res, 'sync', () => syncFeatureCompletion(companyId, userId))");
    expect(CODE).toContain("timeStage(res, 'summary', () => getFeatureCompletionSummary(companyId))");
  });

  it('the roles query uses an async callback — PostgrestBuilder is a thenable, not a Promise', () => {
    expect(CODE).toContain("timeStage(res, 'roles', async () => supabase");
  });
});

describe('B — total timing', () => {
  it('is stamped on every exit inside the measured path', () => {
    // 401 unauthorized, 400 no company, 200 success, 500 catch.
    expect(CODE.split("appendServerTiming(res, 'total', Date.now() - handlerStart);").length - 1).toBe(4);
  });

  it('starts the clock after the pre-try 405 guard, as /api/reports does', () => {
    const clock = CODE.indexOf('const handlerStart = Date.now();');
    const methodGuard = CODE.indexOf("req.method !== 'GET'");
    expect(clock).toBeGreaterThan(-1);
    expect(methodGuard).toBeGreaterThan(clock);
  });
});

describe('C — success path unchanged', () => {
  it('returns the same payload shape and status', () => {
    expect(CODE).toContain('return res.status(200).json({');
    expect(CODE).toContain('success: true,');
    expect(CODE).toContain('data: response,');
    expect(CODE).toContain('syncedAt: new Date().toISOString(),');
    expect(CODE).toContain('companyId,');
  });

  it('the response builder is untouched', () => {
    expect(CODE).toContain('const response: FeatureCompletionResponse = {');
    expect(CODE).toContain('percentage: summary.percentage,');
  });
});

describe('D — error and early-return paths unchanged', () => {
  it('405 still returns before any timing work', () => {
    expect(CODE).toContain("error: 'Method not allowed',");
    const guard = CODE.indexOf("error: 'Method not allowed',");
    const firstStage = CODE.indexOf("timeStage(res, 'auth'");
    expect(firstStage).toBeGreaterThan(guard);
  });

  it('401 / 400 / 500 keep their status and body', () => {
    expect(CODE).toContain("return res.status(401).json({ success: false, error: 'Unauthorized' });");
    expect(CODE).toContain("error: 'Company not found for user',");
    expect(CODE).toContain('error: `Failed to fetch feature completion: ${(err as Error).message}`,');
  });

  it('authorization and tenant scoping are untouched', () => {
    expect(CODE).toContain("from('user_company_roles')");
    expect(CODE).toContain(".eq('user_id', userId)");
    expect(CODE).toContain(".eq('status', 'active')");
    expect(CODE).toContain('allowedCompanyIds.includes(requestedCompanyId)');
  });

  it('a sync failure still logs and continues rather than failing the request', () => {
    expect(CODE).toContain("console.error('[feature-completion] Sync error:', err);");
  });
});

describe('E — no duplication', () => {
  it.each(STAGES)('%s is wrapped exactly once', (stage) => {
    expect(CODE.split(`timeStage(res, '${stage}'`).length - 1).toBe(1);
  });

  it('MUTATION GUARD: feature_completion is read ONCE, not twice', () => {
    // getFeatureCompletionSummary already returns the rows on .features.
    // Calling getFeatureCompletionStatus from the route as well reintroduces
    // the duplicate sequential hop this change removed (median ~427ms).
    expect(CODE).not.toContain('getFeatureCompletionStatus(companyId)');
    expect(CODE).toContain('const features = summary.features;');
  });

  it('the response payload still carries both features and summary', () => {
    expect(CODE).toContain('features: features.map(');
    expect(CODE).toContain('total: summary.total,');
    expect(CODE).toContain('completed: summary.completed,');
  });

  it('uses the shared helper rather than a new mechanism', () => {
    expect(CODE).toContain("from '../../lib/platform/serverTiming'");
    // Phase 37 widened this import to pull in the sink helpers. Everything
    // still comes from the one shared module — no second timing mechanism.
    expect(
      CODE.split('import { appendServerTiming, createTimingSink, flushTimingSink, timeStage }').length - 1,
    ).toBe(1);
    expect(CODE.split("from '../../lib/platform/serverTiming'").length - 1).toBe(1);
  });

  it('no query or external call was added', () => {
    expect(CODE.split("from('user_company_roles')").length - 1).toBe(1);
    // Phase 31: removed, not added. The route no longer calls this directly —
    // getFeatureCompletionSummary performs the single read internally.
    expect(CODE.split('getFeatureCompletionStatus(companyId)').length - 1).toBe(0);
    expect(CODE.split('getFeatureCompletionSummary(companyId)').length - 1).toBe(1);
    expect(CODE.split('syncFeatureCompletion(companyId, userId)').length - 1).toBe(1);
  });
});
