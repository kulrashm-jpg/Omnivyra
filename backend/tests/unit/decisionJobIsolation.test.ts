/**
 * Decision-generating jobs: one failure no longer kills the rest (e9, 2026-11-12).
 *
 * In prod every decision_objects write raised 23502 (decision_event_trigger_company_id). That
 * exposed three couplings that turned one company's failure into everyone's:
 *   1. feedbackIntelligence: the per-company loop had no catch, so the first failure aborted every
 *      company after it. A THROTTLE (DecisionGenerationThrottledError) aborted it too.
 *   2. runDataDrivenIntelligenceForCompany: Promise.all over 19 engines lost every count when one
 *      engine rejected.
 *   3. dailyIntelligence: a company job ran only after a campaign job SUCCEEDED, and inside it
 *      a failing detectOpportunities skipped the engines, the priority recompute and the
 *      behaviour alerts.
 * Each fix has its own case; removing it fails exactly that case (mutants recorded in the commit).
 *
 * REAL: generateFeedbackInsights, runDataDrivenIntelligenceForCompany, runDailyIntelligence,
 * DecisionGenerationThrottledError. FAKED: the decision writers, the engines and the jobs' other
 * I/O. A generic supabase double answers only the tables declared below; anything else throws.
 */
import { DecisionGenerationThrottledError } from '../../services/decisionGenerationControlService';

// ── shared doubles ────────────────────────────────────────────────────────────
const tables: Record<string, () => { data: unknown; error: unknown }> = {};
const writes: Array<{ table: string; method: string; arg: Record<string, unknown> }> = [];
function chain(table: string) {
  if (!(table in tables)) throw new Error(`undeclared table ${table}`);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'delete', 'eq', 'not', 'order', 'limit', 'in', 'maybeSingle', 'single', 'gte', 'lt']) {
    b[m] = () => b;
  }
  for (const m of ['insert', 'update', 'upsert']) {
    b[m] = (arg: Record<string, unknown>) => { writes.push({ table, method: m, arg }); return b; };
  }
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(tables[table]()).then(res, rej);
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => chain(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => chain(t) }));

jest.mock('../../services/intelligenceExecutionContext', () => ({
  assertBackgroundJobContext: () => undefined,
  runInBackgroundJobContext: (_n: string, fn: () => unknown) => fn(),
}));

const throttle = jest.fn();
jest.mock('../../services/decisionGenerationControlService', () => {
  const actual = jest.requireActual('../../services/decisionGenerationControlService');
  return { ...actual, enforceDecisionGenerationThrottle: (...a: unknown[]) => throttle(...a) };
});

const archiveDecisionScope = jest.fn();
jest.mock('../../services/decisionObjectService', () => ({
  archiveDecisionScope: (...a: unknown[]) => archiveDecisionScope(...a),
  replaceDecisionObjectsForSource: jest.fn(async () => []),
  listDecisionObjects: jest.fn(async () => []),
}));

let signals: Array<Record<string, unknown>> = [];
jest.mock('../../services/normalizeFeedbackSignalsService', () => ({ loadNormalizedFeedbackSignals: async () => signals }));

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  throttle.mockReset().mockResolvedValue(undefined);
  archiveDecisionScope.mockReset().mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

// ── 1. feedbackIntelligence ───────────────────────────────────────────────────
describe('1. feedbackIntelligence: per-company catch + continue', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateFeedbackInsights } = require('../../services/feedbackIntelligenceEngine');
  // Zero engagement => no drafts => the archive path, one call per company.
  const sig = (company: string) => ({ id: company, company_id: company, post_id: 'p', platform: 'linkedin', engagement_type: 'like', engagement_count: 0 });

  it('a failing company and a THROTTLED company do not stop the companies after them', async () => {
    signals = [sig('co-a'), sig('co-b'), sig('co-c'), sig('co-d')];
    throttle.mockImplementation(async (co: string) => {
      if (co === 'co-c') throw new DecisionGenerationThrottledError('feedbackIntelligenceEngine blocked by min_refresh_interval for company co-c.', 'co-c', 'feedbackIntelligenceEngine');
    });
    archiveDecisionScope.mockImplementation(async (scope: { company_id: string }) => {
      if (scope.company_id === 'co-b') throw new Error('23502 null value in column "company_id"');
    });
    const r = await generateFeedbackInsights();
    expect(archiveDecisionScope.mock.calls.map((c) => c[0].company_id)).toEqual(['co-a', 'co-b', 'co-d']);
    expect(r).toMatchObject({ companies_processed: 4, companies_failed: 1, companies_throttled: 1, decisions_archived: 2 });
  });

  it('every attempted company failing is an outage: the run fails', async () => {
    signals = [sig('co-a'), sig('co-b')];
    archiveDecisionScope.mockRejectedValue(new Error('23502'));
    await expect(generateFeedbackInsights()).rejects.toThrow('all 2 attempted companies failed');
  });

  it('all companies throttled is NOT an outage', async () => {
    signals = [sig('co-a')];
    throttle.mockRejectedValue(new DecisionGenerationThrottledError('blocked', 'co-a', 'feedbackIntelligenceEngine'));
    await expect(generateFeedbackInsights()).resolves.toMatchObject({ companies_throttled: 1, companies_failed: 0 });
  });
});

// ── 2. the 19 data-driven engines ─────────────────────────────────────────────
const ENGINE_MODULES: Array<[string, string]> = [
  ['advancedRevenueAttributionIntelligenceService', 'generateAdvancedRevenueAttributionDecisions'],
  ['authorityIntelligenceService', 'generateAuthorityIntelligenceDecisions'],
  ['backlinkAuthorityIntelligenceService', 'generateBacklinkAuthorityDecisions'],
  ['brandTrustIntelligenceService', 'generateBrandTrustIntelligenceDecisions'],
  ['competitorIntelligenceService', 'generateCompetitorIntelligenceDecisionObjects'],
  ['competitorNormalizationIntelligenceService', 'generateCompetitorNormalizationDecisions'],
  ['contentAuthorityService', 'generateContentAuthorityDecisions'],
  ['distributionIntelligenceService', 'generateDistributionIntelligenceDecisions'],
  ['funnelIntelligenceService', 'generateFunnelIntelligenceDecisions'],
  ['geoIntelligenceService', 'generateGeoIntelligenceDecisions'],
  ['geoStrategyIntelligenceService', 'generateGeoStrategyIntelligenceDecisions'],
  ['intentIntelligenceService', 'generateIntentIntelligenceDecisions'],
  ['leadIntelligenceService', 'generateLeadIntelligenceDecisions'],
  ['portfolioDecisionEngine', 'generatePortfolioDecisionObjects'],
  ['seoIntelligenceService', 'generateSeoIntelligenceDecisions'],
  ['trafficIntelligenceService', 'generateTrafficIntelligenceDecisions'],
  ['trustIntelligenceService', 'generateTrustIntelligenceDecisions'],
  ['velocityIntelligenceService', 'generateVelocityIntelligenceDecisions'],
];
const engineImpl: Record<string, jest.Mock> = {};
for (const [, fn] of ENGINE_MODULES) engineImpl[fn] = jest.fn();
// jest.mock factories are hoisted; each looks its implementation up lazily.
jest.mock('../../services/advancedRevenueAttributionIntelligenceService', () => ({ generateAdvancedRevenueAttributionDecisions: (...a: unknown[]) => engineImpl.generateAdvancedRevenueAttributionDecisions(...a) }));
jest.mock('../../services/authorityIntelligenceService', () => ({ generateAuthorityIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateAuthorityIntelligenceDecisions(...a) }));
jest.mock('../../services/backlinkAuthorityIntelligenceService', () => ({ generateBacklinkAuthorityDecisions: (...a: unknown[]) => engineImpl.generateBacklinkAuthorityDecisions(...a) }));
jest.mock('../../services/brandTrustIntelligenceService', () => ({ generateBrandTrustIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateBrandTrustIntelligenceDecisions(...a) }));
jest.mock('../../services/competitorIntelligenceService', () => ({ generateCompetitorIntelligenceDecisionObjects: (...a: unknown[]) => engineImpl.generateCompetitorIntelligenceDecisionObjects(...a) }));
jest.mock('../../services/competitorNormalizationIntelligenceService', () => ({ generateCompetitorNormalizationDecisions: (...a: unknown[]) => engineImpl.generateCompetitorNormalizationDecisions(...a) }));
jest.mock('../../services/contentAuthorityService', () => ({ generateContentAuthorityDecisions: (...a: unknown[]) => engineImpl.generateContentAuthorityDecisions(...a) }));
jest.mock('../../services/distributionIntelligenceService', () => ({ generateDistributionIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateDistributionIntelligenceDecisions(...a) }));
jest.mock('../../services/funnelIntelligenceService', () => ({ generateFunnelIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateFunnelIntelligenceDecisions(...a) }));
jest.mock('../../services/geoIntelligenceService', () => ({ generateGeoIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateGeoIntelligenceDecisions(...a) }));
jest.mock('../../services/geoStrategyIntelligenceService', () => ({ generateGeoStrategyIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateGeoStrategyIntelligenceDecisions(...a) }));
jest.mock('../../services/intentIntelligenceService', () => ({ generateIntentIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateIntentIntelligenceDecisions(...a) }));
jest.mock('../../services/leadIntelligenceService', () => ({ generateLeadIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateLeadIntelligenceDecisions(...a) }));
jest.mock('../../services/portfolioDecisionEngine', () => ({ generatePortfolioDecisionObjects: (...a: unknown[]) => engineImpl.generatePortfolioDecisionObjects(...a) }));
jest.mock('../../services/seoIntelligenceService', () => ({ generateSeoIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateSeoIntelligenceDecisions(...a) }));
jest.mock('../../services/trafficIntelligenceService', () => ({ generateTrafficIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateTrafficIntelligenceDecisions(...a) }));
jest.mock('../../services/trustIntelligenceService', () => ({ generateTrustIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateTrustIntelligenceDecisions(...a) }));
jest.mock('../../services/velocityIntelligenceService', () => ({ generateVelocityIntelligenceDecisions: (...a: unknown[]) => engineImpl.generateVelocityIntelligenceDecisions(...a) }));
const competitive = jest.fn();
jest.mock('../../services/competitiveIntelligenceEngine', () => ({ persistCompetitiveIntelligenceDecisions: (...a: unknown[]) => competitive(...a) }));
jest.mock('../../services/companyIntelligenceAggregator', () => ({ aggregateCompanyIntelligence: async () => ({}) }));
jest.mock('../../services/evidenceActivationService', () => ({ activateProviderEvidence: async () => ({ authority: null, trust: null }) }));

const twoDecisions = async () => [{ id: 1 }, { id: 2 }];
function allEnginesSucceed() {
  for (const k of Object.keys(engineImpl)) engineImpl[k].mockReset().mockImplementation(twoDecisions);
  competitive.mockReset().mockImplementation(twoDecisions);
}

describe('2. runDataDrivenIntelligenceForCompany: one engine failing keeps the other 18', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  // The REAL module: section 3 mocks this module file-wide for runDailyIntelligence.
  const { runDataDrivenIntelligenceForCompany } = jest.requireActual('../../services/dataDrivenIntelligenceScheduler');

  it('a rejected engine counts 0 and is NAMED; the others keep their counts', async () => {
    allEnginesSucceed();
    engineImpl.generateSeoIntelligenceDecisions.mockRejectedValue(new Error('23502 on decision_events'));
    const r = await runDataDrivenIntelligenceForCompany('co-a');
    expect(r.seo).toBe(0);
    expect(r.traffic).toBe(2);
    expect(r.competitiveSignals).toBe(2);
    expect(r.total).toBe(18 * 2);
    expect(r.failed).toEqual([{ engine: 'seo', error: '23502 on decision_events' }]);
  });

  it('all 19 succeeding: failed is empty', async () => {
    allEnginesSucceed();
    const r = await runDataDrivenIntelligenceForCompany('co-a');
    expect(r.total).toBe(19 * 2);
    expect(r.failed).toEqual([]);
  });
});

// ── 3. dailyIntelligence ──────────────────────────────────────────────────────
const calls: string[] = [];
const dlq: string[] = [];
const detectOpportunities = jest.fn();
const runDataDriven = jest.fn();
jest.mock('../../services/workerRetryService', () => ({
  // Faithful to the real shape: up to 3 attempts, then dead-letter under the given name and rethrow.
  executeWithRetry: async (name: string, _p: unknown, fn: () => Promise<unknown>) => {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      calls.push(`attempt:${name}`);
      try { return await fn(); } catch (e) { last = e; }
    }
    dlq.push(name);
    throw last;
  },
  moveToDeadLetter: jest.fn(),
}));
jest.mock('../../services/jobRunner', () => ({
  // The campaign job FAILS without running (as a 23502 on its strategic-insight write would);
  // the company job runs its body.
  runJob: async (spec: { jobName: string; idempotencyKey: string }, body: () => Promise<unknown>) => {
    if (spec.jobName === 'job:daily-intelligence:campaign') {
      calls.push(`campaign_job:${spec.idempotencyKey.split(':')[3]}`);
      // The campaign body RUNS (until its first fault), so anything it does first, such as a throttle
      // call, is exercised rather than skipped by this double. Its later I/O is undeclared and throws,
      // so the job FAILS, as a 23502 on its strategic-insight write would.
      try { await body(); } catch (e) { return { status: 'failed', error: e }; }
      return { status: 'failed', error: new Error('campaign failed (23502)') };
    }
    await body();
    return { status: 'completed' };
  },
}));
jest.mock('../../services/opportunityDetectionService', () => ({ detectOpportunities: (...a: unknown[]) => detectOpportunities(...a) }));
jest.mock('../../services/dataDrivenIntelligenceScheduler', () => {
  const actual = jest.requireActual('../../services/dataDrivenIntelligenceScheduler');
  return { ...actual, runDataDrivenIntelligenceForCompany: (...a: unknown[]) => runDataDriven(...a) };
});
const failStep = { priority_recompute: false, behavior_alerts: false };
jest.mock('../../services/prioritizationService', () => ({
  recomputePrioritiesForCompany: async () => { calls.push('priority_recompute'); if (failStep.priority_recompute) throw new Error('prio down'); },
}));
jest.mock('../../services/behaviorAlertService', () => ({
  evaluateBehaviorAlerts: async () => { calls.push('behavior_alerts'); if (failStep.behavior_alerts) throw new Error('alerts down'); return { sent: 1, deduplicated: 0 }; },
}));
const outcomesFail = jest.fn();
jest.mock('../../services/behaviorActionTrackingService', () => ({
  evaluateBehaviorActionOutcomes: async () => { calls.push('behavior_action_outcomes'); await outcomesFail(); },
}));
jest.mock('../../db/campaignVersionStore', () => ({ getTrendSnapshots: async () => [] }));
jest.mock('../../services/engagementThreadService', () => ({ getThreads: async () => [] }));
jest.mock('../../services/intelligenceEventService', () => ({ emitIntelligenceEvent: async () => null }));
jest.mock('../../services/intelligenceAlertService', () => ({ sendIntelligenceAlert: async () => ({}) }));
for (const m of ['../../db/campaignApprovedVersionStore', '../../db/platformExecutionStore', '../../db/contentAssetStore',
  '../../services/campaignMemoryService', '../../db/performanceStore', '../../jobs/campaignHealthEvaluationJob',
  '../../services/strategicInsightService', '../../services/campaignOutcomeLearningService', '../../services/narrativePerformanceService',
  '../../services/growthIntelligence', '../../services/businessIntelligenceService']) {
  jest.doMock(m, () => ({}));
}
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: async () => null }));

describe('3. dailyIntelligence: a failed campaign still queues its company; company steps are isolated', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runDailyIntelligence, computeDailyRunStatus } = require('../../jobs/dailyIntelligenceScheduler');
  const summary = (failed: Array<{ engine: string; error: string }> = []) => {
    const r: Record<string, unknown> = { total: 0, failed };
    for (const k of ['traffic', 'funnel', 'seo', 'contentAuthority', 'lead', 'brandTrust', 'backlinkAuthority', 'competitorNormalization', 'competitorIntelligence', 'competitiveSignals', 'distribution', 'authority', 'geo', 'trust', 'intent', 'velocity', 'portfolio', 'geoStrategy', 'advancedRevenueAttribution']) r[k] = 0;
    return r;
  };

  // Each case has ONE fault, so each fix is pinned by its own case. Every case needs the company
  // job to run at all, so the "failed campaign still queues its company" mutant (M3) fails all four;
  // the isolation (M4), per-step retry (M5) and engine-recording (M6) mutants each fail one.
  beforeEach(() => {
    calls.length = 0;
    dlq.length = 0;
    Object.assign(tables, {
      scheduler_locks: () => ({ data: null, error: null }),
      intelligence_job_runs: () => ({ data: { id: 'run-1' }, error: null }),
      campaign_versions: () => ({ data: [{ campaign_id: 'camp-1', company_id: 'co-a' }], error: null }),
      campaigns: () => ({ data: [{ id: 'camp-1', status: 'active' }], error: null }),
    });
    detectOpportunities.mockReset().mockImplementation(async () => { calls.push('opportunities'); return []; });
    runDataDriven.mockReset().mockImplementation(async () => { calls.push('data_driven_engines'); return summary(); });
    outcomesFail.mockReset().mockResolvedValue(undefined);
    failStep.priority_recompute = false;
    failStep.behavior_alerts = false;
    writes.length = 0;
    // Like the REAL throttle: keyed by COMPANY ONLY (decision_generation_controls PK company_id),
    // shared by every source, refusing a second generation inside the 60-minute minimum.
    const generatedRecently = new Set<string>();
    throttle.mockImplementation(async (co: string, source: string) => {
      calls.push(`throttle:${co}:${source}`);
      if (generatedRecently.has(co)) throw new DecisionGenerationThrottledError(`${source} blocked by min_refresh_interval for company ${co}.`, co, source);
      generatedRecently.add(co);
    });
  });
  const ran = () => calls.filter((c) => !c.startsWith('attempt:') && !c.startsWith('campaign_job:') && !c.startsWith('throttle:'));
  const attempts = (n: string) => calls.filter((c) => c === `attempt:job:daily-intelligence:company:${n}`).length;

  it('QUEUE: the company job runs although its only campaign job FAILED', async () => {
    await runDailyIntelligence();
    expect(ran().filter((c) => !c.startsWith('campaign_job:') && !c.startsWith('throttle:'))).toEqual(
      ['opportunities', 'data_driven_engines', 'priority_recompute', 'behavior_alerts', 'behavior_action_outcomes']);
  });

  it('NO THROTTLE: both campaigns of one company are processed, and daily never consults the throttle', async () => {
    tables.campaign_versions = () => ({ data: [{ campaign_id: 'camp-1', company_id: 'co-a' }, { campaign_id: 'camp-2', company_id: 'co-a' }], error: null });
    tables.campaigns = () => ({ data: [{ id: 'camp-1', status: 'active' }, { id: 'camp-2', status: 'active' }], error: null });
    const r = await runDailyIntelligence();
    expect(calls.filter((c) => c.startsWith('campaign_job:')).sort()).toEqual(['campaign_job:camp-1', 'campaign_job:camp-2']);
    expect(calls.filter((c) => c.startsWith('throttle:'))).toEqual([]);
    expect(r.errors.some((e: string) => /throttl|blocked by/.test(e))).toBe(false);
  });

  it('FEEDBACK NOT BLOCKED: a daily run for a company does not throttle feedbackIntelligence for it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { generateFeedbackInsights } = require('../../services/feedbackIntelligenceEngine');
    await runDailyIntelligence();
    signals = [{ id: 's1', company_id: 'co-a', post_id: 'p', platform: 'linkedin', engagement_type: 'like', engagement_count: 0 }];
    const fb = await generateFeedbackInsights();
    expect(fb).toMatchObject({ companies_throttled: 0, companies_failed: 0, decisions_archived: 1 });
  });

  const runStatus = () => writes.filter((w) => w.table === 'intelligence_job_runs' && w.method === 'update').map((w) => w.arg.status);

  it('STATUS failed: every company that ran failed all five steps (and it is logged at ERROR)', async () => {
    detectOpportunities.mockImplementation(async () => { throw new Error('opp down'); });
    runDataDriven.mockImplementation(async () => { throw new Error('engines down'); });
    failStep.priority_recompute = true;
    failStep.behavior_alerts = true;
    outcomesFail.mockRejectedValue(new Error('outcomes down'));
    const r = await runDailyIntelligence();
    expect(r).toMatchObject({ companies_ran: 1, company_step_failures: 5, companies_all_steps_failed: 1 });
    expect(runStatus()).toEqual(['failed']);
    expect((console.error as jest.Mock).mock.calls.some((c) => String(c[0]).includes('run FAILED'))).toBe(true);
  });

  it('STATUS completed_with_errors: a partial failure is not reported as clean', async () => {
    failStep.behavior_alerts = true;
    const r = await runDailyIntelligence();
    expect(r).toMatchObject({ companies_ran: 1, company_step_failures: 1, companies_all_steps_failed: 0 });
    expect(runStatus()).toEqual(['completed_with_errors']);
  });

  it('STATUS EMPTY RUN: no eligible company is NOT failed (no vacuous "all failed")', async () => {
    tables.campaign_versions = () => ({ data: [], error: null });
    const r = await runDailyIntelligence();
    expect(r).toMatchObject({ companies_ran: 0, companies_all_steps_failed: 0 });
    expect(runStatus()).toEqual(['completed']);
  });

  it('ISOLATION: a failing detectOpportunities no longer skips the engines, priorities or behaviour alerts', async () => {
    detectOpportunities.mockImplementation(async () => { calls.push('opportunities'); throw new Error('23502 on decision_events'); });
    const r = await runDailyIntelligence();
    const after = ran().filter((c) => c !== 'opportunities');
    expect(after).toEqual(['data_driven_engines', 'priority_recompute', 'behavior_alerts', 'behavior_action_outcomes']);
    expect(r.errors.some((e: string) => e.includes('co-a: step opportunities: 23502'))).toBe(true);
  });

  it('RETRY: only the FAILING step is retried and dead-lettered; the steps that succeeded run once', async () => {
    outcomesFail.mockRejectedValue(new Error('outcomes table unreachable'));
    await runDailyIntelligence();
    expect(attempts('opportunities')).toBe(1);
    expect(attempts('data_driven_engines')).toBe(1);
    expect(attempts('behavior_alerts')).toBe(1);
    expect(attempts('behavior_action_outcomes')).toBe(3);
    expect(dlq).toEqual(['job:daily-intelligence:company:behavior_action_outcomes']);
  });

  it('STATUS engines: engine failures reach the result (and, via computeDailyRunStatus, the status)', async () => {
    runDataDriven.mockImplementation(async () => {
      calls.push('data_driven_engines');
      return summary([{ engine: 'seo', error: 'down' }, { engine: 'traffic', error: 'down' }]);
    });
    const r = await runDailyIntelligence();
    expect(r).toMatchObject({ company_step_failures: 0, engine_failures: 2, companies_all_steps_failed: 0 });
  });

  // The status rule itself, with each signal ISOLATED (the run harness always fails its campaign job,
  // so only a direct call can show that an engine failure ALONE prevents 'completed').
  it.each([
    ['nothing failed', { companiesRan: 1, companiesAllStepsFailed: 0, companyStepFailures: 0, engineFailures: 0, failedCampaigns: 0 }, 'completed'],
    ['no company ran (no vacuous failed)', { companiesRan: 0, companiesAllStepsFailed: 0, companyStepFailures: 0, engineFailures: 0, failedCampaigns: 0 }, 'completed'],
    ['ONLY engines failed (05)', { companiesRan: 1, companiesAllStepsFailed: 0, companyStepFailures: 0, engineFailures: 19, failedCampaigns: 0 }, 'completed_with_errors'],
    ['only a step failed', { companiesRan: 1, companiesAllStepsFailed: 0, companyStepFailures: 1, engineFailures: 0, failedCampaigns: 0 }, 'completed_with_errors'],
    ['only a campaign failed', { companiesRan: 1, companiesAllStepsFailed: 0, companyStepFailures: 0, engineFailures: 0, failedCampaigns: 1 }, 'completed_with_errors'],
    ['every company failed all five', { companiesRan: 2, companiesAllStepsFailed: 2, companyStepFailures: 10, engineFailures: 0, failedCampaigns: 0 }, 'failed'],
    ['one of two companies failed all five', { companiesRan: 2, companiesAllStepsFailed: 1, companyStepFailures: 5, engineFailures: 0, failedCampaigns: 0 }, 'completed_with_errors'],
  ])('computeDailyRunStatus: %s', (_name, input, expected) => {
    expect(computeDailyRunStatus(input)).toBe(expected);
  });

  it('ENGINE: a failed engine is recorded by name, and the engines are not re-run', async () => {
    runDataDriven.mockImplementation(async () => { calls.push('data_driven_engines'); return summary([{ engine: 'seo', error: 'boom' }]); });
    const r = await runDailyIntelligence();
    expect(ran().filter((c) => c === 'data_driven_engines')).toHaveLength(1);
    expect(r.errors.some((e: string) => e.includes('co-a: engine seo: boom'))).toBe(true);
  });
});
