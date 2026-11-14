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
 * org governance, global governance, daily jobs, active states: each read answers what it is told.
 * `activeRows` is a MULTI-TENANT creator_render_job_state table; the active-state read is answered by
 * applying the `.in('render_job_id', ...)` filter it was given (none = every tenant's rows).
 */
function fakeClient(over: {
  org?: R; global?: R; daily?: R; active?: R; activeRows?: { render_job_id: string; current_state: string }[];
  /** The EXACT daily count (head query); default = the daily list's length. */
  dailyCount?: number | null; dailyCountError?: R['error'];
} = {}) {
  const answers = {
    org: over.org ?? ok(null),
    global: over.global ?? ok(null),
    daily: over.daily ?? ok([{ id: 'job-own-1' }]),
  };
  const seen = { activeQueries: 0, activeJobFilter: null as string[] | null };
  const client = {
    seen,
    from(table: string) {
      const f: Record<string, unknown> = {};
      let jobFilter: string[] | null = null;
      let head = false;
      const q: any = {
        select: (_c?: string, opts?: { head?: boolean }) => { head = Boolean(opts?.head); return q; },
        // A HEAD count is awaited directly after its filters.
        then: (resolve: (v: unknown) => unknown) => {
          if (!head) return resolve({ data: null, error: { code: 'TEST', message: 'unexpected bare await' } });
          if (over.dailyCountError) return resolve({ count: null, error: over.dailyCountError });
          const n = over.dailyCount !== undefined ? over.dailyCount : (Array.isArray(answers.daily.data) ? (answers.daily.data as unknown[]).length : null);
          return resolve({ count: n, error: null });
        },
        eq: (k: string, v: unknown) => { f[k] = v; return q; },
        gte: () => q,
        in: (k: string, vs: string[]) => { if (k === 'render_job_id') jobFilter = vs; return q; },
        maybeSingle: async () => (f.organization_id === GLOBAL_GOVERNANCE_SENTINEL ? answers.global : answers.org),
        limit: async () => {
          if (table === 'creator_render_job') return answers.daily;
          seen.activeQueries += 1; seen.activeJobFilter = jobFilter;
          if (over.active) return over.active;
          const rows = (over.activeRows ?? []).filter((r) => jobFilter === null || jobFilter.includes(r.render_job_id));
          return ok(rows);
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
    ['daily job count errors', { daily: err }],
    ['active-state count errors', { active: err }],
    ['daily job count returns no array', { daily: ok(null) }],
    ['active-state count returns no array', { active: ok(null) }],
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

  it('CONCURRENCY IS PER TENANT: other tenants’ active renders do not exhaust this tenant’s cap', async () => {
    const others = Array.from({ length: 10 }, (_, i) => ({ render_job_id: `job-other-${i}`, current_state: 'rendering' }));
    const c = fakeClient({ org: ok({ max_concurrent_renders: 4 }), daily: ok([{ id: 'job-own-1' }]), activeRows: [...others, { render_job_id: 'job-own-1', current_state: 'queued' }] });
    const r = await evaluateRenderGovernanceGate(c, 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: true } });
    expect(c.seen.activeJobFilter).toEqual(['job-own-1']);
  });

  it('the cap still trips on THIS tenant’s own active renders', async () => {
    const own = Array.from({ length: 4 }, (_, i) => ({ id: `job-own-${i}` }));
    const c = fakeClient({ org: ok({ max_concurrent_renders: 4 }), daily: ok(own), activeRows: own.map((j) => ({ render_job_id: j.id, current_state: 'rendering' })) });
    const r = await evaluateRenderGovernanceGate(c, 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: false, event: 'provider_rate_limited' } });
  });

  it('no jobs of this tenant in the window -> concurrency 0 without reading every tenant’s states', async () => {
    const c = fakeClient({ daily: ok([]), activeRows: [{ render_job_id: 'job-other', current_state: 'rendering' }] });
    const r = await evaluateRenderGovernanceGate(c, 'org-1', CTX);
    expect(r).toMatchObject({ ok: true, decision: { allowed: true } });
    expect(c.seen.activeQueries).toBe(0);
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
