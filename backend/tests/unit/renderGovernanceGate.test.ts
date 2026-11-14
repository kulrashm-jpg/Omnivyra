/**
 * The Step-R6 pre-enqueue governance gate FAILS CLOSED on any read it cannot trust (e9 BLOCKING,
 * 2026-11-11). Before, each read's `error` was discarded, so an unreadable kill switch was evaluated as
 * "no governance row" (rendering enabled) and an unreadable count as 0.
 */
import { evaluateRenderGovernanceGate } from '../../services/creator/rendering/governance/renderGovernanceGate';
import { GLOBAL_GOVERNANCE_SENTINEL, evaluateRenderGovernance, coerceGovernanceRow } from '../../services/creator/rendering';

type R = { data: unknown; error: { code: string; message: string } | null };
const ok = (data: unknown): R => ({ data, error: null });
const err: R = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

/**
 * org governance, global governance, the daily count and the active count: each read answers what it is told.
 * `activeRows` is a MULTI-TENANT creator_render_job_state table (each row carries its job's organization_id, as the
 * !inner embed exposes it); the active HEAD count applies the embed filter it was given
 * (creator_render_job.organization_id) and the current_state filter - so a count that forgets the org filter counts
 * every tenant. `seen.activeListQueries` counts any LIST read of creator_render_job_state (the old, capped path); the
 * exact path makes none.
 */
type ActiveRow = { render_job_id: string; current_state: string; organization_id: string };
function fakeClient(over: {
  org?: R; global?: R; daily?: R;
  activeRows?: ActiveRow[]; activeCount?: number | null; activeError?: R['error'];
  /** The EXACT daily count (head query); default = the daily list's length. */
  dailyCount?: number | null; dailyCountError?: R['error'];
} = {}) {
  const answers = { org: over.org ?? ok(null), global: over.global ?? ok(null), daily: over.daily ?? ok([{ id: 'job-own-1' }]) };
  const seen = { activeListQueries: 0, activeOrgFilter: undefined as unknown, activeStateFilter: undefined as unknown };
  const client = {
    seen,
    from(table: string) {
      const f: Record<string, unknown> = {};
      let head = false;
      let stateIn: string[] | null = null;
      const q: any = {
        select: (_c?: string, opts?: { head?: boolean }) => { head = Boolean(opts?.head); return q; },
        then: (resolve: (v: unknown) => unknown) => {
          if (!head) return resolve({ data: null, error: { code: 'TEST', message: 'unexpected bare await' } });
          if (table === 'creator_render_job_state') {
            seen.activeOrgFilter = f['creator_render_job.organization_id'];
            seen.activeStateFilter = stateIn;
            if (over.activeError) return resolve({ count: null, error: over.activeError });
            if (over.activeCount !== undefined) return resolve({ count: over.activeCount, error: null });
            const n = (over.activeRows ?? []).filter((r) =>
              (!('creator_render_job.organization_id' in f) || r.organization_id === f['creator_render_job.organization_id'])
              && (stateIn === null || stateIn.includes(r.current_state))).length;
            return resolve({ count: n, error: null });
          }
          if (over.dailyCountError) return resolve({ count: null, error: over.dailyCountError });
          const n = over.dailyCount !== undefined ? over.dailyCount : (Array.isArray(answers.daily.data) ? (answers.daily.data as unknown[]).length : null);
          return resolve({ count: n, error: null });
        },
        eq: (k: string, v: unknown) => { f[k] = v; return q; },
        gte: () => q,
        in: (k: string, vs: string[]) => { if (k === 'current_state') stateIn = vs; return q; },
        maybeSingle: async () => (f.organization_id === GLOBAL_GOVERNANCE_SENTINEL ? answers.global : answers.org),
        // LIST reads (only the pre-fix control uses them now).
        limit: async () => {
          if (table === 'creator_render_job') return answers.daily;
          seen.activeListQueries += 1;
          return ok(over.activeRows ?? []);
        },
      };
      return q;
    },
  };
  return client;
}
const CTX = { provider: 'openai', assetFamily: 'image' };
const STOP = { emergency_stop: true };

describe('fails CLOSED when a read cannot be trusted', () => {
  it.each([
    ['org governance read errors', { org: err }],
    ['GLOBAL governance read errors (the kill switch)', { global: err }],
    ['daily count errors', { dailyCountError: err.error }],
    ['active count errors', { activeError: err.error }],
    ['daily count has no number', { dailyCount: null }],
    ['active count has no number (never read as 0)', { activeCount: null }],
  ])('%s -> unavailable (the caller refuses the render)', async (_l, over) => {
    const r = await evaluateRenderGovernanceGate(fakeClient(over), 'org-1', CTX);
    expect(r).toMatchObject({ ok: false, reason: 'governance_unavailable' });
  });

  it('a read that THROWS -> unavailable, never an exception', async () => {
    const client = { from: () => { throw new Error('socket hang up'); } };
    const r = await evaluateRenderGovernanceGate(client, 'org-1', CTX);
    expect(r).toMatchObject({ ok: false, reason: 'governance_unavailable' });
  });
});

describe('a readable store is evaluated as before', () => {
  it('no governance rows, nothing running -> allowed (the default policy)', async () => {
    const r = await evaluateRenderGovernanceGate(fakeClient(), 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: true } });
  });

  it('a READABLE global emergency stop blocks', async () => {
    const r = await evaluateRenderGovernanceGate(fakeClient({ global: ok(STOP) }), 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: false, event: 'emergency_stop_active' } });
  });

  it('a READABLE org emergency stop blocks', async () => {
    const r = await evaluateRenderGovernanceGate(fakeClient({ org: ok({ ...STOP, organization_id: 'org-1' }) }), 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: false, event: 'emergency_stop_active' } });
  });

  it('the daily quota still trips on a readable count', async () => {
    const r = await evaluateRenderGovernanceGate(fakeClient({ org: ok({ max_daily_renders: 2 }), daily: ok([{ id: 'a' }, { id: 'b' }]) }), 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: false, event: 'quota_exceeded' } });
  });

  it('the DAILY QUOTA uses an exact count: an org with a cap above 1000 is blocked at its cap (the 1000-row list no longer clamps it)', async () => {
    const thousand = Array.from({ length: 1000 }, (_, i) => ({ id: `job-${i}` })); // what .limit(1000) returns
    const c = fakeClient({ org: ok({ max_daily_renders: 1500 }), daily: ok(thousand), dailyCount: 1600 });
    const r = await evaluateRenderGovernanceGate(c, 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: false, event: 'quota_exceeded' } });
    // CONTROL: the clamped list length (1000) would have been read as under the 1500 cap.
    expect(thousand.length).toBeLessThan(1500);
  });

  it('an exact count that errors, or comes back without a number, fails closed', async () => {
    const a = await evaluateRenderGovernanceGate(fakeClient({ dailyCountError: err.error }), 'org-1', CTX);
    const b = await evaluateRenderGovernanceGate(fakeClient({ dailyCount: null }), 'org-1', CTX);
    expect(a).toMatchObject({ ok: false, reason: 'governance_unavailable' });
    expect(b).toMatchObject({ ok: false, reason: 'governance_unavailable' });
  });

  it('CONCURRENCY IS PER TENANT: other tenants active renders do not exhaust this tenant cap', async () => {
    const others: ActiveRow[] = Array.from({ length: 10 }, (_, i) => ({ render_job_id: 'job-other-' + i, current_state: 'rendering', organization_id: 'org-2' }));
    const c = fakeClient({ org: ok({ max_concurrent_renders: 4 }), activeRows: [...others, { render_job_id: 'job-own-1', current_state: 'queued', organization_id: 'org-1' }] });
    const r = await evaluateRenderGovernanceGate(c, 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: true } });
    expect(c.seen.activeOrgFilter).toBe('org-1');
    expect(c.seen.activeStateFilter).toEqual(['queued', 'rendering', 'processing', 'moderation']);
  });

  it('the cap still trips on THIS tenant own active renders; finished ones do not count', async () => {
    const own: ActiveRow[] = Array.from({ length: 4 }, (_, i) => ({ render_job_id: 'job-own-' + i, current_state: 'rendering', organization_id: 'org-1' }));
    const done: ActiveRow[] = Array.from({ length: 9 }, (_, i) => ({ render_job_id: 'job-done-' + i, current_state: 'completed', organization_id: 'org-1' }));
    const r = await evaluateRenderGovernanceGate(fakeClient({ org: ok({ max_concurrent_renders: 4 }), activeRows: [...own, ...done] }), 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: false, event: 'provider_rate_limited' } });
  });

  it('EXACT (e9/05 2026-11-14): more than 1000 renders in 24h - every in-flight one counts, via the count path, never a capped list', async () => {
    const own: ActiveRow[] = Array.from({ length: 1200 }, (_, i) => ({ render_job_id: 'job-' + i, current_state: i % 2 ? 'rendering' : 'queued', organization_id: 'org-1' }));
    const c = fakeClient({ org: ok({ max_concurrent_renders: 1100 }), activeRows: own });
    const r = await evaluateRenderGovernanceGate(c, 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: false, event: 'provider_rate_limited' } }); // 1200 > 1100
    expect(c.seen.activeListQueries).toBe(0); // the capped list path is never used
  });

  it('CONTROL: the PRE-FIX route logic, on the same unreadable kill switch, ALLOWED the render', async () => {
    // A faithful copy of the old render-image.ts gate (only `data` destructured; counts default to 0).
    const preFix = async (supabase: any, orgId: string) => {
      const [{ data: orgGovRow }, { data: globalGovRow }, { data: dailyJobs }] = await Promise.all([
        supabase.from('creator_render_governance_state').select('*').eq('organization_id', orgId).maybeSingle(),
        supabase.from('creator_render_governance_state').select('*').eq('organization_id', GLOBAL_GOVERNANCE_SENTINEL).maybeSingle(),
        supabase.from('creator_render_job').select('id').eq('organization_id', orgId).gte('created_at', 'x').limit(1000),
      ]);
      const { data: activeStates } = await supabase.from('creator_render_job_state').select('current_state').in('current_state', []).limit(1000);
      return evaluateRenderGovernance(
        orgGovRow ? coerceGovernanceRow(orgGovRow, orgId) : null,
        globalGovRow ? coerceGovernanceRow(globalGovRow, GLOBAL_GOVERNANCE_SENTINEL) : null,
        { provider: 'openai', assetFamily: 'image',
          dailyRenderCount: Array.isArray(dailyJobs) ? dailyJobs.length : 0,
          concurrentRenderCount: Array.isArray(activeStates) ? activeStates.length : 0 },
      );
    };
    expect((await preFix(fakeClient({ global: err }), 'org-1')).allowed).toBe(true);   // fail-OPEN
    expect((await evaluateRenderGovernanceGate(fakeClient({ global: err }), 'org-1', CTX)).ok).toBe(false); // now refused
  });
});
