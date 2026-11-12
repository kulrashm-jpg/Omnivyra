/**
 * unread-error pkg 2: the 6-hourly campaign health monitor (it PAUSES campaigns) and the auto-scaler it
 * calls. PostgREST returns an error, never throws. Before: a failed pause was reported as PAUSED (the user
 * was told, a recovery campaign was generated) while the campaign kept publishing; a failed previous-
 * status read reset the escalation chain; a failed report write broke it for the next run; failed reads
 * of engagement / active campaigns were silent no-op runs; optimization and recovery were fire-and-forget
 * and reported done before they ran; the scaler reported actions whose writes failed.
 *
 * Hostile fake: every terminal is keyed by table + operation (+ selected columns for reads); anything
 * this suite does not configure THROWS. One fault per case.
 *
 * SUGGEST-ONLY (owner ruling via e9, 2026-11-12): the monitor and the scaler never write to a customer's
 * campaign. 'campaigns:update' is unconfigured in every case, so a write throws AND is recorded.
 */
type Result = { data: unknown; error: { message: string } | null };

let results: Record<string, Result> = {};
let writes: Array<{ key: string; payload: unknown }> = [];

function makeBuilder(table: string) {
  let op = '';
  let cols = '';
  let payload: unknown;
  const key = () => (op === 'select' && table === 'campaigns' ? `${table}:select:${cols}` : `${table}:${op}`);
  const settle = (): Result => {
    const k = key();
    // Every write ATTEMPT is recorded before the configuration check, so an unconfigured write is
    // both a throw AND visible to wrote() (no vacuous absence assertion).
    if (op !== 'select') writes.push({ key: k, payload });
    const r = results[k];
    if (!r) throw new Error(`hostile fake: unconfigured ${k}`);
    return r;
  };
  const b: any = {
    select: (c: string) => { if (!op) { op = 'select'; cols = c; } return b; },
    update: (p: unknown) => { op = 'update'; payload = p; return b; },
    insert: (p: unknown) => { op = 'insert'; payload = p; return b; },
    eq: () => b, in: () => b, gte: () => b, order: () => b, limit: () => b,
    maybeSingle: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('direct supabase not expected'); } } }));
jest.mock('../../services/configService', () => ({
  getDecisionConfig: jest.fn(async () => ({
    at_risk_windows: 2, min_engagement_threshold: 0.01, critical_drop_percent: 0.4, critical_runs_for_pause: 2,
    ad_scale_threshold: 0.05, accuracy_good_threshold: 0.7,
  })),
}));
/** Suggest-only: the monitor no longer generates a recovery campaign (its notification said "was paused"). */
const mockRecovery = jest.fn(async (..._a: unknown[]) => { throw new Error('generateRecoveryCampaign must not be called'); });
jest.mock('../../services/campaignRecoveryService', () => ({ generateRecoveryCampaign: (...a: unknown[]) => mockRecovery(...a) }));
const mockLogDecision = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/autonomousDecisionLogger', () => ({ logDecision: (...a: unknown[]) => mockLogDecision(...a) }));
const mockPerf = jest.fn(async (..._a: unknown[]) => ({ engagement_rate: 0.2, accuracy_score: 0.9, impressions: 5000 }));
jest.mock('../../services/performanceFeedbackService', () => ({ aggregateCampaignPerformance: (...a: unknown[]) => mockPerf(...a) }));
jest.mock('../../services/campaignLearningsStore', () => ({ upsertLearning: jest.fn(async () => undefined) }));

import { runCampaignHealthMonitor } from '../../services/campaignHealthMonitor';
import { tryAutoScale } from '../../services/campaignAutoScalingService';

const ok = (data: unknown): Result => ({ data, error: null });
const boom = (): Result => ({ data: null, error: { message: 'boom' } });
const H = 3_600_000;
/** Two 6-hour windows (12 h apart) for c1 at the given engagement rates. */
const engagement = (a: number, b: number) => ok([
  { campaign_id: 'c1', engagement_rate: a, collected_at: new Date(Date.now() - 13 * H).toISOString() },
  { campaign_id: 'c1', engagement_rate: b, collected_at: new Date(Date.now() - 1 * H).toISOString() },
]);

function baseResults(): Record<string, Result> {
  return {
    'campaigns:select:id, company_id': ok([{ id: 'c1', company_id: 'co-1' }]),
    'performance_feedback:select': engagement(0.001, 0.001),
    'campaign_health_reports:select': ok(null),
    'campaign_health_reports:insert': ok(null),
    // SUGGEST-ONLY: 'campaigns:update' is deliberately NOT configured, so ANY write to a customer's
    // campaign throws in every case of this suite (and fails it via result.errors or a rejection).
    'campaigns:select:company_id, name': ok({ company_id: 'co-1', name: 'C1' }),
    'notifications:insert': ok(null),
    'campaigns:select:posting_frequency, platforms': ok({ posting_frequency: { linkedin: 5 }, platforms: ['linkedin'] }),
    'campaigns:select:company_id': ok({ company_id: 'co-1' }),
    'campaigns:select:posting_frequency': ok({ posting_frequency: { linkedin: 5 } }),
    'campaign_decision_log:insert': ok(null),
  };
}
/** The previous report that makes this run the second CRITICAL one (-> pause RECOMMENDED). */
const PAUSE_DUE = ok({ report: { health_status: 'AT_RISK', critical_run_count: 1 } });
/** Already past the threshold: the recommendation was made on an earlier run. Only the >40% drop path
 *  chains CRITICAL runs (the 'AT_RISK persisted' path needs a previous AT_RISK), so the case uses it. */
const PAUSE_ALREADY_RECOMMENDED = ok({ report: { health_status: 'CRITICAL', critical_run_count: 2 } });

const wrote = (k: string) => writes.filter((w) => w.key === k);
const reportStatus = () => (wrote('campaign_health_reports:insert')[0]?.payload as { health_status?: string } | undefined)?.health_status;

beforeEach(() => {
  results = baseResults();
  writes = [];
  mockRecovery.mockClear();
  mockLogDecision.mockClear();
  mockPerf.mockClear();
});

describe('pause RECOMMENDED (suggest-only; was auto-pause)', () => {
  beforeEach(() => { results['campaign_health_reports:select'] = PAUSE_DUE; });

  it('CONTROL: a due pause is RECOMMENDED (decision + notification), the campaign is NOT written, the report stays CRITICAL', async () => {
    const r = await runCampaignHealthMonitor();
    expect(r).toMatchObject({ pause_recommended: ['c1'], critical: ['c1'], errors: [] });
    expect(wrote('campaigns:update')).toEqual([]);
    expect(mockLogDecision).toHaveBeenCalledWith(expect.objectContaining({ decision_type: 'pause', outcome: expect.stringContaining('RECOMMENDED (not applied)') }));
    const note = wrote('notifications:insert')[0]?.payload as { type?: string; body?: string };
    expect(note.type).toBe('campaign_pause_recommended');
    expect(note.body).toMatch(/We recommend pausing it\. Nothing was changed\./);
    expect(note.body).not.toMatch(/was (automatically )?paused/);
    expect(mockRecovery).not.toHaveBeenCalled();
    expect(reportStatus()).toBe('CRITICAL');
  });

  it('the recommendation is made ONCE: a run already past the threshold does not notify again', async () => {
    results['campaign_health_reports:select'] = PAUSE_ALREADY_RECOMMENDED;
    results['performance_feedback:select'] = engagement(0.02, 0.001); // a >40% drop: CRITICAL again (count 3)
    const r = await runCampaignHealthMonitor();
    expect(r).toMatchObject({ pause_recommended: [], critical: ['c1'], errors: [] });
    expect(wrote('notifications:insert')).toEqual([]);
  });

  it('a failed notification INSERT is reported (the recommendation decision is still recorded)', async () => {
    results['notifications:insert'] = boom();
    const r = await runCampaignHealthMonitor();
    expect(r.errors.join('\n')).toMatch(/c1: pause recommendation not sent: boom/);
    expect(mockLogDecision).toHaveBeenCalledWith(expect.objectContaining({ decision_type: 'pause' }));
    expect(reportStatus()).toBe('CRITICAL');
  });

  it('an unreadable campaign for the notification is reported, and nothing is inserted', async () => {
    results['campaigns:select:company_id, name'] = boom();
    const r = await runCampaignHealthMonitor();
    expect(r.errors.join('\n')).toMatch(/c1: pause recommendation not sent: campaign unreadable: boom/);
    expect(wrote('notifications:insert')).toEqual([]);
  });
});

describe('escalation chain', () => {
  it('an UNREADABLE previous report fails the evaluation (no fresh-start report, no pause)', async () => {
    results['campaign_health_reports:select'] = boom();
    const r = await runCampaignHealthMonitor();
    expect(r.errors.join('\n')).toMatch(/c1: previous health report unreadable: boom/);
    expect(wrote('campaign_health_reports:insert')).toEqual([]);
    expect(wrote('campaigns:update')).toEqual([]);
  });

  it('a FAILED report write is reported (the next run depends on it)', async () => {
    results['campaign_health_reports:insert'] = boom();
    const r = await runCampaignHealthMonitor();
    expect(r.errors.join('\n')).toMatch(/c1: health report not written: boom/);
  });
});

describe('run-level reads', () => {
  it('UNREADABLE engagement data fails the run loudly, never "no data" for every campaign', async () => {
    results['performance_feedback:select'] = boom();
    const r = await runCampaignHealthMonitor();
    expect(r.errors).toEqual(['Monitor failed: engagement windows unreadable: boom']);
    expect(r.campaigns_evaluated).toBe(0);
  });

  it('UNREADABLE active campaigns fails the run loudly, never a silent empty run', async () => {
    results['campaigns:select:id, company_id'] = boom();
    const r = await runCampaignHealthMonitor();
    expect(r.errors).toEqual(['Monitor failed: active campaigns unreadable: boom']);
  });
});

describe('AT_RISK: lower frequency RECOMMENDED (suggest-only; was a write)', () => {
  it('CONTROL: the PROPOSED frequency is recorded as a recommendation, the campaign is NOT written', async () => {
    const r = await runCampaignHealthMonitor();
    expect(r).toMatchObject({ at_risk: ['c1'], optimization_recommended: ['c1'], errors: [] });
    expect(wrote('campaigns:update')).toEqual([]);
    expect(mockLogDecision).toHaveBeenCalledWith(expect.objectContaining({
      decision_type: 'optimize',
      metrics_used: expect.objectContaining({ current_frequency: { linkedin: 5 }, proposed_frequency: { linkedin: 4 } }),
      outcome: expect.stringContaining('RECOMMENDED (not applied)'),
    }));
    expect(reportStatus()).toBe('AT_RISK');
  });

  it('an UNREADABLE campaign is not "recommended", logs no decision, and is reported', async () => {
    results['campaigns:select:posting_frequency, platforms'] = boom();
    const r = await runCampaignHealthMonitor();
    expect(r.optimization_recommended).toEqual([]);
    expect(r.errors.join('\n')).toMatch(/c1: optimization: campaign unreadable: boom/);
    expect(mockLogDecision).not.toHaveBeenCalled();
  });
});

describe('auto-scale (HEALTHY)', () => {
  beforeEach(() => { results['performance_feedback:select'] = engagement(0.2, 0.2); });

  it('CONTROL: tryAutoScale records the budget recommendation and the learning, and reports them', async () => {
    const r = await tryAutoScale('c1');
    expect(r.scaled).toBe(true);
    expect(r.failed_actions).toEqual([]);
    expect(r.actions.join('\n')).toMatch(/Ad budget recommendation/);
    expect(r.actions.join('\n')).toMatch(/Winning content pattern saved/);
    expect(wrote('campaign_decision_log:insert')).toHaveLength(1);
  });

  it('SUGGEST-ONLY (e9 ruling): a healthy run NEVER writes posting_frequency (any campaigns update throws here)', async () => {
    const direct = await tryAutoScale('c1');
    expect(direct.scaled).toBe(true);
    expect(direct.actions.join('\n')).not.toMatch(/posting frequency/i);
    const viaMonitor = await runCampaignHealthMonitor();
    expect(viaMonitor).toMatchObject({ scaled: ['c1'], errors: [] });
    expect(wrote('campaigns:update')).toEqual([]);
    expect(writes.map((w) => w.key)).not.toContain('campaigns:update');
  });

  it('an UNREADABLE company throws (never a silent skip of the learning and decision log)', async () => {
    results['campaigns:select:company_id'] = boom();
    await expect(tryAutoScale('c1')).rejects.toThrow(/company_id unreadable: boom/);
  });

  it('an UNREADABLE frequency throws before anything is changed', async () => {
    results['campaigns:select:posting_frequency'] = boom();
    await expect(tryAutoScale('c1')).rejects.toThrow(/posting_frequency unreadable: boom/);
    expect(writes).toEqual([]);
  });


  it('a FAILED budget record is a failed action, never a reported one, and the decision says FAILED', async () => {
    results['campaign_decision_log:insert'] = boom();
    const r = await tryAutoScale('c1');
    expect(r.failed_actions).toEqual(['Ad budget recommendation not recorded: boom']);
    expect(r.actions.join('\n')).not.toMatch(/Ad budget recommendation/);
    expect(mockLogDecision).toHaveBeenCalledWith(expect.objectContaining({ outcome: expect.stringContaining('FAILED: Ad budget recommendation not recorded') }));
  });

  it('the monitor reports a scaler failure and a scaler failed_action, instead of swallowing them', async () => {
    results['campaign_decision_log:insert'] = boom();
    const r1 = await runCampaignHealthMonitor();
    expect(r1.scaled).toEqual(['c1']);
    expect(r1.errors.join('\n')).toMatch(/c1: auto-scale: Ad budget recommendation not recorded: boom/);

    results = baseResults();
    results['performance_feedback:select'] = engagement(0.2, 0.2);
    results['campaigns:select:company_id'] = boom();
    writes = [];
    const r2 = await runCampaignHealthMonitor();
    expect(r2.scaled).toEqual([]);
    expect(r2.errors.join('\n')).toMatch(/c1: auto-scale: company_id unreadable: boom/);
  });
});
