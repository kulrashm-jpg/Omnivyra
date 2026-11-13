/**
 * C75 (e1 2026-11-13) - EXECUTES processCreatorStructuredSchedule (the real per-row retry loop) with the billing
 * engine faked: one charge per row generation, the charged output is stashed on the row at once and reused by every
 * later attempt and run (never re-run, never re-charged), the stash never reaches the prompt, a billing refusal is
 * classified by its typed flag and not retried in-run, and the not-enforced path is unchanged.
 */
const ledger = new Map<string, 'settled' | 'released'>();
let charges = 0;
const mockEngine = {
  makeIdempotencyKey: jest.fn((u: string, a: string, r: string) => `${u}|${a}|${r}`),
  executeWithEntryConsumption: jest.fn(async (opts: any) => {
    const st = ledger.get(opts.idempotencyKey);
    if (st === 'settled') return { status: 'already_settled' };
    if (st === 'released') return { status: 'already_released' };
    try {
      const result = await opts.executor();
      ledger.set(opts.idempotencyKey, 'settled'); charges++;
      return { status: 'executed', result, settlement: {} };
    } catch (e) { ledger.set(opts.idempotencyKey, 'released'); throw e; }
  }),
};
jest.mock('../../services/creditExecutionService', () => mockEngine);
let mockMode = 'enforce';
jest.mock('../../services/billing/creditEconomyActivation', () => ({ getCreditEconomyExecutionMode: jest.fn(async () => mockMode) }));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn() }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

// row writes: every update to daily_content_plans is recorded
const mockWrites: Array<{ table: string; values: any; id: unknown }> = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    update: (values: any) => ({ eq: async (_c: string, id: unknown) => { mockWrites.push({ table, values, id }); return { data: null, error: null }; } }),
  }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));

const mockEngineCalls = { generate: [] as any[], schedule: 0 };
let mockScheduleFailures = 0;
jest.mock('../../services/executionEngines', () => ({
  getExecutionEngine: () => ({
    generateFromIntent: async (intent: any) => { mockEngineCalls.generate.push(intent); return { asset_type: 'carousel', asset_instruction: { template_id: 't-1' }, body: `gen-${mockEngineCalls.generate.length}` }; },
    adaptForPlatform: async (o: any) => o,
    schedule: async () => {
      mockEngineCalls.schedule++;
      if (mockScheduleFailures > 0) { mockScheduleFailures--; return { status: 'failed', failure_reason: 'network timeout' }; }
      return { status: 'scheduled', scheduledPostId: 'sp-1', publish_source: 'x', platform_id: 'p', verified: true, published: false };
    },
  }),
}));
jest.mock('../../services/creatorExecutionContracts', () => ({
  validateCreatorExecutionOutput: () => ({ ok: true, issues: [] }),
  validateCreatorSchedulingContract: () => ({ ok: true, issues: [] }),
}));
jest.mock('../../services/creatorAssetValidationService', () => ({ validateAssetReadiness: async () => ({ ready: true }) }));
jest.mock('../../services/creatorExecutionAuditService', () => ({ logCreatorExecutionAudit: jest.fn(async () => undefined) }));
jest.mock('../../services/creatorExecutionLockService', () => ({
  CreatorExecutionLockError: class extends Error {},
  acquireCreatorExecutionLock: jest.fn(async () => ({ attempt_count: 1, retry_count: 0, max_retries: 3 })),
  extendCreatorExecutionLease: jest.fn(async () => undefined),
  releaseCreatorExecutionLock: jest.fn(async () => undefined),
}));
jest.mock('../../services/creatorExecutionRateLimitService', () => ({
  CreatorExecutionRateLimitError: class extends Error {},
  assertCreatorExecutionWithinRateLimits: jest.fn(async () => undefined),
}));
jest.mock('../../services/creatorExecutionObservabilityService', () => ({
  recordCreatorExecutionMetric: jest.fn(async () => undefined),
  upsertCreatorExecutionSummary: jest.fn(async () => undefined),
  writeCreatorDeadLetter: jest.fn(async () => undefined),
}));
for (const m of [
  '../../middleware/queueBackpressure', '../../services/boltRowFailureDiagnostics', '../../services/platformIntelligenceService',
  '../../services/boltScheduleBlockProcessor', '../../services/campaignScheduleEligibilityService', '../../queue/contentGenerationQueues',
  '../../scheduler/schedulerService', '../../services/queueHealth', '../../services/creator/creatorRowScheduler',
]) jest.doMock(m, () => ({}));
jest.mock('../../services/structuredPlanSchedulerModel', () => ({
  ...jest.requireActual('../../services/structuredPlanSchedulerModel'),
  getCurrentCampaignPlanVersion: jest.fn(async () => 3),
  startCreatorLeaseHeartbeat: () => ({ stop: async () => undefined }),
  sleep: async () => undefined,
}));

// required AFTER the doMock loop (an ES import could be ordered before it)
export {};
const { processCreatorStructuredSchedule } = require('../../services/structuredPlanSchedulerExecWeeklyA') as typeof import('../../services/structuredPlanSchedulerExecWeeklyA');

const rowWith = (content: Record<string, unknown>) => ({
  id: 'row-1', campaign_id: 'c-1', content_type: 'carousel', platform: 'linkedin', plan_version: 3,
  date: '2026-12-01', scheduled_time: '10:00', topic: 'T', content: JSON.stringify(content),
}) as any;
const run = (row: any) => processCreatorStructuredSchedule({
  campaignId: 'c-1', companyId: 'org-1', userId: 'u-1', dailyPlans: [row],
  accountMap: new Map([['linkedin', 'acct-1']]), normalize: ((p: string) => p) as any,
  typeMapByPlatform: {}, currentPlanVersion: 3,
});
const rowContents = () => mockWrites.filter((w) => w.table === 'daily_content_plans' && typeof w.values.content === 'string').map((w) => JSON.parse(w.values.content));

beforeEach(() => {
  ledger.clear(); charges = 0; mockMode = 'enforce'; mockWrites.length = 0;
  mockEngineCalls.generate.length = 0; mockEngineCalls.schedule = 0; mockScheduleFailures = 0;
  mockEngine.executeWithEntryConsumption.mockClear();
});

it('enforced: scheduling keeps failing - the row is generated and charged ONCE, the stash is written at once and kept', async () => {
  mockScheduleFailures = 99;
  const out = await run(rowWith({ creator_card: { x: 1 } }));
  expect(out.scheduled_count).toBe(0);
  expect(mockEngineCalls.schedule).toBe(3);          // the in-run retries happened...
  expect(mockEngineCalls.generate).toHaveLength(1);  // ...but generation (the AI) ran once
  expect(charges).toBe(1);
  const contents = rowContents();
  expect(contents[0].billed_generation).toMatchObject({ plan_version: 3, reference_id: 'creator_row:c-1:row-1:v3' }); // immediate stash write
  expect(contents.at(-1).billed_generation).toMatchObject({ plan_version: 3 });                                          // kept by the final persist
});

it('enforced: the NEXT run reuses the stash - no AI, no charge - schedules, and drops the spent stash', async () => {
  mockScheduleFailures = 99;
  await run(rowWith({}));
  const stashed = rowContents().at(-1);
  mockWrites.length = 0; mockEngineCalls.generate.length = 0; mockScheduleFailures = 0;
  mockEngine.executeWithEntryConsumption.mockClear();
  const out = await run(rowWith(stashed));
  expect(out.scheduled_count).toBe(1);
  expect(mockEngineCalls.generate).toHaveLength(0);
  expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
  expect(charges).toBe(1);
  expect(rowContents().at(-1)).not.toHaveProperty('billed_generation');
});

it('a stash NEVER reaches the prompt (an older plan version regenerates without it in enrichedIntent/existingContent)', async () => {
  await run(rowWith({ creator_card: { x: 1 }, billed_generation: { plan_version: 2, reference_id: 'old', output: { body: 'OLD' } } }));
  expect(mockEngineCalls.generate).toHaveLength(1);
  const intent = mockEngineCalls.generate[0];
  expect(intent.enrichedIntent).not.toHaveProperty('billed_generation');
  expect(intent.existingContent).not.toHaveProperty('billed_generation');
  expect(JSON.stringify(intent)).not.toContain('OLD');
});

it('a retryable billing refusal is NOT retried in-run and is persisted as transient (a later run can succeed)', async () => {
  mockEngine.executeWithEntryConsumption.mockResolvedValueOnce({ status: 'insufficient_credits', available: 0, required: 9 } as any);
  const out = await run(rowWith({}));
  expect(out.scheduled_count).toBe(0);
  expect(mockEngine.executeWithEntryConsumption).toHaveBeenCalledTimes(1);
  expect(mockEngineCalls.generate).toHaveLength(0);
  const final = mockWrites.filter((w) => w.table === 'daily_content_plans').at(-1)!.values;
  expect(final.failure_type).toBe('transient');
  expect(final.failure_reason).toContain('INSUFFICIENT_CREDITS');
});

it('a permanent billing refusal (charged, no stash) is persisted as permanent and never regenerates', async () => {
  ledger.set('org-1|content_generation|creator_row:c-1:row-1:v3', 'settled');
  await run(rowWith({}));
  expect(mockEngineCalls.generate).toHaveLength(0);
  expect(mockWrites.filter((w) => w.table === 'daily_content_plans').at(-1)!.values.failure_type).toBe('permanent');
});

it('NOT enforced: today\'s path - generation per attempt, no engine call, no stash written', async () => {
  mockMode = 'off';
  mockScheduleFailures = 99;
  await run(rowWith({}));
  expect(mockEngineCalls.generate).toHaveLength(3);
  expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
  for (const c of rowContents()) expect(c).not.toHaveProperty('billed_generation');
});
