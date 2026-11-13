/**
 * Market Pulse charging (owner ruling via e9, 2026-11-13): each region LLM call is charged as ONE insight_generation
 * through runBilledAiCompletion; whole-scan pre-check; per-(job, region) idempotency; failures release; the charged
 * credits settle into market_pulse_runs.credits_consumed.
 *
 * Real: processMarketPulseJobV1, generateMarketPulseForRegion, runBilledAiCompletion, regionCharging.
 * Faked: the orchestrator (a wallet + holds keyed by the idempotency descriptor), the gateway, pricing, DB tables.
 */
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------- fake DB (ownedDbTable)
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
function reset() { for (const k of Object.keys(tables)) delete tables[k]; }
function tableRows(name: string) { return (tables[name] ??= []); }
function builder(name: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let patch: Row | null = null;
  const filters: Array<[string, unknown]> = [];
  const match = () => tableRows(name).filter((r) => filters.every(([c, v]) => r[c] === v));
  const run = () => {
    if (op === 'update') { match().forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    return { data: match(), error: null };
  };
  const b: any = {
    select: () => b,
    update: (p: Row) => { op = 'update'; patch = p; return b; },
    insert: (row: Row) => { tableRows(name).push({ ...row }); return Promise.resolve({ data: null, error: null }); },
    eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
    single: () => { const m = match(); return Promise.resolve({ data: m[0] ?? null, error: m[0] ? null : { message: 'no rows' } }); },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (name: string) => builder(name) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));

// ---------------------------------------------------------------- generator deps
jest.mock('../../services/contextResolver', () => ({ buildUnifiedContext: jest.fn(async () => '') }));
jest.mock('../../services/strategicThemeEngine', () => ({ getStrategicThemesAsOpportunities: jest.fn(async () => []) }));
const runDiagnosticPrompt = jest.fn();
jest.mock('../../services/llm/openaiAdapter', () => ({ runDiagnosticPrompt: (...a: unknown[]) => runDiagnosticPrompt(...a) }));
jest.mock('../../services/marketPulseAggregationService', () => ({ aggregateMarketPulseFromDb: jest.fn(async () => []) }));

// ---------------------------------------------------------------- pricing + balance
const resolveActivityCreditRange = jest.fn();
jest.mock('../../services/pricingService', () => ({ resolveActivityCreditRange: (...a: unknown[]) => resolveActivityCreditRange(...a) }));
const getTotalAvailable = jest.fn();
jest.mock('../../services/creditPriorityService', () => ({ getTotalAvailable: (...a: unknown[]) => getTotalAvailable(...a) }));

// ---------------------------------------------------------------- gateway + guard
const llmOutputs: string[] = [];
const runCompletionWithOperation = jest.fn(async () => ({
  output: llmOutputs.shift() ?? JSON.stringify({ topics: [{ topic: 'Rising pain', spike_reason: 'x', shelf_life_days: 7, risk_level: 'LOW', priority_score: 0.6, trend_velocity: 0.5 }] }),
  metadata: { token_usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200 }, provider: 'openai', model: 'gpt-4o-mini' },
}));
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: (...a: unknown[]) => (runCompletionWithOperation as any)(...a) }));
const handlesSeen: unknown[] = [];
jest.mock('../../services/billing/aiGatewayBillingGuard', () => ({
  checkAiBillingGuard: jest.fn(async () => undefined),
  runWithCreditHandle: async (h: unknown, fn: () => Promise<unknown>) => { handlesSeen.push(h); return fn(); },
}));

// ---------------------------------------------------------------- fake orchestrator (wallet + holds)
// Credit numbers come from the (mocked) shared pricing resolver - never hard-coded (e1: rates are owner data).
const PRICE = { actionKey: 'insight_generation', minCredits: 8, maxCredits: 80, expectedCredits: 8, tokenPriced: true, source: 'action_pricing_config' };
const PER_REGION = PRICE.minCredits;
const wallet = { balance: 0 };
const holds: Array<{ key: string; orgId: string; action: string; amount: number; state: 'held' | 'confirmed' | 'released' }> = [];
const emitAnomaly = jest.fn();
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: (...a: unknown[]) => emitAnomaly(...a) }));
jest.mock('../../services/billing/enterpriseBillingOrchestrator', () => ({
  runBilledOperation: async (opts: any) => {
    const key = JSON.stringify(opts.idempotency);
    const prior = holds.find((h) => h.key === key);
    if (prior?.state === 'confirmed') return { operationId: 'op', correlationId: 'c', idempotencyKey: key, result: { status: 'already_confirmed' } };
    // executeWithCredits answers already_released when the key's release row exists (a failed earlier attempt)
    if (prior?.state === 'released') return { operationId: 'op', correlationId: 'c', idempotencyKey: key, result: { status: 'already_released' } };
    if (wallet.balance < PER_REGION) return { operationId: 'op', correlationId: 'c', idempotencyKey: key, result: { status: 'insufficient_credits', available: wallet.balance, required: PER_REGION } };
    const hold = { key, orgId: opts.orgId, action: opts.action, amount: PER_REGION, state: 'held' as const };
    holds.push(hold as any);
    try {
      const out = await opts.executor();
      (hold as any).state = 'confirmed';
      wallet.balance -= PER_REGION;
      return { operationId: 'op', correlationId: 'c', idempotencyKey: key, result: { status: 'executed', result: out.result, settlement: { creditsCharged: PER_REGION, actualUsage: { inputTokens: 900, outputTokens: 300 } } } };
    } catch (err) {
      (hold as any).state = 'released';
      throw err;
    }
  },
}));

import { processMarketPulseJobV1 } from '../../services/marketPulseJobProcessor';
import { generateMarketPulseForRegion } from '../../services/opportunityGenerators';
import { sumRegionCreditsCharged, resolveMarketPulseBillingUser } from '../../services/marketPulse/regionCharging';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
function seedJob(id: string, regions: string[], insight_source: 'llm' | 'hybrid' | 'api' = 'llm', region_results: Record<string, unknown> | null = null) {
  tableRows('market_pulse_jobs_v1').push({ id, company_id: ORG, status: 'PENDING', regions, context_payload: { insight_source, triggered_by_user_id: USER }, error: null, region_results });
}
const job = (id: string) => tableRows('market_pulse_jobs_v1').find((r) => r.id === id)!;

beforeEach(() => {
  reset();
  holds.length = 0;
  handlesSeen.length = 0;
  llmOutputs.length = 0;
  runCompletionWithOperation.mockClear();
  emitAnomaly.mockClear();
  runDiagnosticPrompt.mockReset();
  runDiagnosticPrompt.mockResolvedValue({ data: { topics: [] }, raw: '{}', model: 'm' });
  // prod shape (C79): the shared resolver returns the insight_generation floor at the org's rate (0.01 -> 8 credits)
  resolveActivityCreditRange.mockResolvedValue(PRICE);
  getTotalAvailable.mockImplementation(async () => wallet.balance);
  wallet.balance = 100;
});

describe('Market Pulse region charging', () => {
  it('sufficient balance: every region runs, takes exactly ONE hold as insight_generation, and is charged the per-region price', async () => {
    seedJob('j1', ['US', 'IN']);
    await processMarketPulseJobV1('j1');
    expect(runCompletionWithOperation).toHaveBeenCalledTimes(2);
    expect(holds).toHaveLength(2);
    expect(holds.every((h) => h.orgId === ORG && h.action === 'insight_generation' && h.state === 'confirmed')).toBe(true);
    expect(new Set(holds.map((h) => h.key)).size).toBe(2); // distinct regions are never deduped against each other
    expect(wallet.balance).toBe(100 - 2 * PER_REGION);
    expect(job('j1').status).toBe('COMPLETED');
    expect(sumRegionCreditsCharged(job('j1').region_results)).toBe(2 * PER_REGION);
    expect(handlesSeen.length).toBe(2); // the gateway call ran inside a credit handle
    expect(runDiagnosticPrompt).not.toHaveBeenCalled(); // the unbilled path is gone
  });

  it('pre-check: balance below regions x floor -> scan skipped, NO LLM call, nothing charged, admins notified', async () => {
    wallet.balance = 2 * PER_REGION - 1; // one short of 2 regions
    seedJob('j2', ['US', 'IN']);
    await processMarketPulseJobV1('j2');
    expect(runCompletionWithOperation).not.toHaveBeenCalled();
    expect(holds).toHaveLength(0);
    expect(wallet.balance).toBe(2 * PER_REGION - 1);
    expect(job('j2').status).toBe('FAILED');
    expect(String(job('j2').error)).toBe(`insufficient_credits: Market Pulse needs ${2 * PER_REGION} credits (${PER_REGION} per region) but ${2 * PER_REGION - 1} are available`);
    expect(tableRows('notifications')).toEqual([expect.objectContaining({ organization_id: ORG, category: 'market_pulse_skipped' })]);
  });

  it('shared pricing resolver fails -> fails CLOSED (skipped, never run uncharged)', async () => {
    resolveActivityCreditRange.mockRejectedValue(new Error('[pricingService] Missing valid credit_rate_usd for org x'));
    seedJob('j3', ['US']);
    await processMarketPulseJobV1('j3');
    expect(runCompletionWithOperation).not.toHaveBeenCalled();
    expect(holds).toHaveLength(0);
    expect(job('j3').status).toBe('FAILED');
    expect(String(job('j3').error)).toMatch(/^pricing_unavailable/);
  });

  it('a hold refused mid-scan stops the remaining regions (not run, not charged) and notifies', async () => {
    wallet.balance = 3 * PER_REGION; // pre-check passes for 3 regions, then the balance is spent elsewhere
    seedJob('j4', ['US', 'IN', 'UK']);
    runCompletionWithOperation.mockImplementationOnce(async () => { wallet.balance = PER_REGION + 1; return { output: JSON.stringify({ topics: [] }), metadata: { token_usage: { total_tokens: 1 }, provider: 'openai', model: 'm' } } as any; });
    await processMarketPulseJobV1('j4');
    // US charged (1 left), IN refused (insufficient), UK never attempted
    expect(runCompletionWithOperation).toHaveBeenCalledTimes(1);
    expect(holds).toHaveLength(1);
    const rr = job('j4').region_results;
    expect(rr.IN).toEqual({ error: true, code: 'INSUFFICIENT_CREDITS', charged: false, message: expect.stringMatching(/^insufficient_credits: Market Pulse stopped before region IN \(completed and charged: US\)/) });
    expect(rr.UK).toEqual({ error: true, code: 'INSUFFICIENT_CREDITS', charged: false, message: rr.IN.message });
    expect(tableRows('notifications')[0].message).toContain('completed and charged: US');
    expect(job('j4').status).toBe('COMPLETED_WITH_WARNINGS');
    expect(tableRows('notifications')).toHaveLength(1);
  });

  it('invalid JSON from the model -> the hold is RELEASED (not charged) and the region is recorded as failed', async () => {
    llmOutputs.push('not json');
    seedJob('j5', ['US']);
    await processMarketPulseJobV1('j5');
    expect(holds).toEqual([expect.objectContaining({ state: 'released' })]);
    expect(wallet.balance).toBe(100);
    expect(job('j5').status).toBe('FAILED');
    expect(job('j5').region_results.US).toEqual({ error: true, message: 'LLM response is not valid JSON' });
  });

  it('retry of the same (job, region) -> one hold total, no second LLM call, no second charge', async () => {
    const billing = { userId: USER, jobId: 'j6' };
    await generateMarketPulseForRegion(ORG, 'US', { insight_source: 'llm' }, undefined, billing);
    await expect(generateMarketPulseForRegion(ORG, 'US', { insight_source: 'llm' }, undefined, billing))
      .rejects.toMatchObject({ name: 'BilledAiNotExecutedError', status: 'already_confirmed' });
    expect(holds).toHaveLength(1);
    expect(runCompletionWithOperation).toHaveBeenCalledTimes(1);
    expect(wallet.balance).toBe(100 - PER_REGION);
  });

  // e1 review (money): a retried job must never show a CHARGED region as a generic error.
  const charge = (jobId: string, region: string) => generateMarketPulseForRegion(ORG, region, { insight_source: 'llm' }, undefined, { userId: USER, jobId });
  it('retry, already_confirmed WITH a stored result -> the stored result is preserved (no second charge, no error)', async () => {
    await charge('j8', 'US'); // the earlier attempt: charged
    const stored = { topics: [{ topic: 'Earlier', spike_reason: 'x', shelf_life_days: 7, risk_level: 'LOW', priority_score: 0.5 }], credits_charged: PER_REGION };
    seedJob('j8', ['US'], 'llm', { US: stored });
    await processMarketPulseJobV1('j8');
    expect(job('j8').region_results.US).toEqual(stored);
    expect(holds).toHaveLength(1);
    expect(runCompletionWithOperation).toHaveBeenCalledTimes(1);
    expect(emitAnomaly).not.toHaveBeenCalled();
    expect(job('j8').status).toBe('COMPLETED');
  });
  it('a region KEPT from an earlier attempt counts as charged in a later credit-stop notice', async () => {
    await charge('j11', 'US');
    seedJob('j11', ['US', 'IN'], 'llm', { US: { topics: [], credits_charged: PER_REGION } });
    getTotalAvailable.mockResolvedValueOnce(1000); // pre-check passes; the wallet itself is then empty
    wallet.balance = 0;
    await processMarketPulseJobV1('j11');
    expect(job('j11').region_results.IN).toEqual(expect.objectContaining({ code: 'INSUFFICIENT_CREDITS', message: expect.stringContaining('(completed and charged: US)') }));
  });
  it('retry, already_confirmed with NO stored result -> CHARGED_NO_OUTPUT (charged:true) + a critical ops anomaly', async () => {
    await charge('j9', 'US');
    seedJob('j9', ['US']);
    await processMarketPulseJobV1('j9');
    expect(job('j9').region_results.US).toEqual({ error: true, charged: true, code: 'CHARGED_NO_OUTPUT', message: expect.stringContaining('was charged by an earlier attempt') });
    expect(emitAnomaly).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, kind: 'charged_no_output', severity: 'critical', metadata: expect.objectContaining({ job_id: 'j9', region: 'US' }) }));
    expect(holds).toHaveLength(1);
  });
  it('retry, already_released -> ALREADY_RELEASED (charged:false), no LLM call, no charge', async () => {
    llmOutputs.push('not json');
    await expect(charge('j10', 'US')).rejects.toThrow('LLM response is not valid JSON'); // earlier attempt: released
    runCompletionWithOperation.mockClear();
    seedJob('j10', ['US']);
    await processMarketPulseJobV1('j10');
    expect(job('j10').region_results.US).toEqual({ error: true, charged: false, code: 'ALREADY_RELEASED', message: expect.stringContaining('was not charged') });
    expect(runCompletionWithOperation).not.toHaveBeenCalled();
    expect(wallet.balance).toBe(100);
  });

  it("CONTROL: an 'api' (DB-only) scan makes no LLM call and is not charged", async () => {
    seedJob('j7', ['US'], 'api');
    await processMarketPulseJobV1('j7');
    expect(runCompletionWithOperation).not.toHaveBeenCalled();
    expect(holds).toHaveLength(0);
    expect(job('j7').status).toBe('COMPLETED');
  });

  it('billing actor: the triggering user when it is a UUID, else the company (system sentinel)', () => {
    expect(resolveMarketPulseBillingUser(ORG, USER)).toBe(USER);
    expect(resolveMarketPulseBillingUser(ORG, 'content_architect')).toBe(ORG);
    expect(resolveMarketPulseBillingUser(ORG, undefined)).toBe(ORG);
  });
});

describe('settlement + route wiring', () => {
  it('sumRegionCreditsCharged sums only charged regions', () => {
    expect(sumRegionCreditsCharged({ US: { topics: [], credits_charged: 8 }, IN: { error: true, message: 'x' }, UK: { topics: [], credits_charged: 80 } })).toBe(88);
    expect(sumRegionCreditsCharged(null)).toBe(0);
  });
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
  it('syncLegacyJobIntoRun settles credits_consumed from the job region_results', () => {
    const src = read('backend/services/marketPulseV2ServiceEngine.ts');
    const block = src.slice(src.indexOf('export async function syncLegacyJobIntoRun'), src.indexOf("if (!['completed', 'completed_with_warnings'].includes(nextStatus))"));
    expect(block).toMatch(/credits_consumed: sumRegionCreditsCharged\(legacyJob\.region_results\)/);
  });
  it('the run route records the triggering user and refuses an unaffordable LLM scan with 402 before creating the job', () => {
    const src = read('pages/api/market-pulse/run.ts');
    const guardAt = src.indexOf("if (resolvedInput.source_strategy !== 'api') {");
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(src.indexOf(".from('market_pulse_jobs_v1')"));
    const guard = src.slice(guardAt, src.indexOf('const contextPayload', guardAt));
    expect(guard).toContain('precheckMarketPulseScan(companyId, regionsNormalized.length)');
    expect(guard).toMatch(/if \(!precheck\.ok\) \{\s*const shortfall = precheck as MarketPulseScanShortfall;\s*return res\.status\(402\)/);
    expect(src).toMatch(/res\.status\(402\)/);
    expect(src).toMatch(/triggered_by_user_id: access\.userId/);
  });
});
