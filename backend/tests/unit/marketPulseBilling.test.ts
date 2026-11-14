/**
 * OWNER 2026-11-14 (e9 D1a + D2a): Market Pulse is billed 8 credits per AI region - HOLD 8 x regions at run start,
 * SETTLE 8 x regions COMPLETED capped at the hold, release the rest; cadence weekly by default, daily honoured.
 * Helper + processor cases (the doors are in marketPulseBillingDoors.test.ts).
 */
const calls: Array<{ fn: string; args: any[] }> = [];
let reserveResult: any = null;
jest.mock('../../services/creditExecutionService', () => ({
  reserveCreditsForWork: async (...a: any[]) => { calls.push({ fn: 'reserve', args: a }); return reserveResult; },
  confirmCreditReservationToActual: async (...a: any[]) => { calls.push({ fn: 'confirmToActual', args: a }); return { status: 'confirmed', creditsCharged: a[1] }; },
  releaseCreditReservation: async (...a: any[]) => { calls.push({ fn: 'release', args: a }); return { status: 'released' }; },
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));

// Processor fakes: one job row; per-region generator outcomes are scripted.
let jobRow: any = null;
let cancelled = false;
const regionOutcome: Record<string, 'ok' | 'fail'> = {};
const updates: any[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: any = {};
    b.select = () => b; b.eq = () => b;
    b.single = async () => (table === 'market_pulse_jobs_v1'
      ? { data: cancelled ? { ...jobRow, error: 'Cancelled by user' } : jobRow, error: null } : { data: null, error: null });
    b.update = (u: any) => { updates.push({ table, u }); return { eq: async () => ({ error: null }) }; };
    b.insert = async () => ({ error: null });
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no supabase read expected'); } } }));
const aiCalls: string[] = [];
jest.mock('../../services/opportunityGenerators', () => ({
  generateMarketPulseForRegion: async (_c: string, region: string) => {
    aiCalls.push(region);
    if (regionOutcome[region] === 'fail') throw new Error(`region ${region} failed`);
    return { topics: [{ topic: `t-${region}`, spike_reason: 'x', shelf_life_days: 3, risk_level: 'LOW', priority_score: 1 }] };
  },
}));
jest.mock('../../services/marketPulseAggregationService', () => ({ aggregateMarketPulseFromDb: async () => [] }));

import {
  billableRegionCount, holdMarketPulseRun, isMarketPulseRunDue, settleMarketPulseRun, MARKET_PULSE_CREDITS_PER_REGION,
} from '../../services/marketPulse/marketPulseBilling';
import { processMarketPulseJobV1 } from '../../services/marketPulseJobProcessor';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const handle = (credits: number) => ({ orgId: ORG, userId: ORG, action: 'market_pulse', referenceType: 'market_pulse_run', referenceId: JOB,
  idempotencyKey: 'k', holdTransactionId: 'h', creditsReserved: credits, split: { free: credits, paid: 0, incentive: 0 } });
const REGIONS15 = Array.from({ length: 15 }, (_, i) => `R${i}`);

beforeEach(() => { calls.length = 0; updates.length = 0; aiCalls.length = 0; cancelled = false; for (const k of Object.keys(regionOutcome)) delete regionOutcome[k]; });

describe('hold', () => {
  test('a 15-region run holds 120 (8 x 15) as action market_pulse, keyed on the job id', async () => {
    reserveResult = { status: 'reserved', ...handle(120) };
    const r = await holdMarketPulseRun({ orgId: ORG, userId: ORG, jobId: JOB, regions: REGIONS15, insightSource: 'hybrid', validateMembership: true });
    expect(r).toMatchObject({ ok: true, credits: 120 });
    expect(calls[0].args[0]).toMatchObject({ action: 'market_pulse', amountOverride: 120, referenceId: JOB, referenceType: 'market_pulse_run' });
  });

  test("an 'api' (DB-only, no AI) run holds nothing", async () => {
    expect(billableRegionCount(REGIONS15, 'api')).toBe(0);
    const r = await holdMarketPulseRun({ orgId: ORG, userId: ORG, jobId: JOB, regions: REGIONS15, insightSource: 'api', validateMembership: true });
    expect(r).toEqual({ ok: true, reservation: null, credits: 0 });
    expect(calls).toEqual([]);
  });

  test('a refused hold is a typed 402 (insufficient) - never ok', async () => {
    reserveResult = { status: 'insufficient_credits', required: 16, available: 3 };
    const r = await holdMarketPulseRun({ orgId: ORG, userId: ORG, jobId: JOB, regions: ['A', 'B'], insightSource: 'hybrid', validateMembership: true });
    expect(r).toMatchObject({ ok: false, status: 402, code: 'INSUFFICIENT_CREDITS', retryable: false, required: 16, available: 3 });
  });

  test('a reservation that throws is a typed 503 BILLING_UNAVAILABLE (fail closed)', async () => {
    reserveResult = null;
    const mod = require('../../services/creditExecutionService');
    const orig = mod.reserveCreditsForWork;
    mod.reserveCreditsForWork = async () => { throw new Error('db down'); };
    try {
      const r = await holdMarketPulseRun({ orgId: ORG, userId: ORG, jobId: JOB, regions: ['A'], insightSource: 'hybrid', validateMembership: true });
      expect(r).toMatchObject({ ok: false, status: 503, code: 'BILLING_UNAVAILABLE', retryable: true });
    } finally { mod.reserveCreditsForWork = orig; }
  });
});

describe('settle', () => {
  test('3 of 15 regions completed -> charges 24 (8 x 3) and the partial confirm releases the rest', async () => {
    expect(await settleMarketPulseRun(handle(120) as any, 3)).toEqual({ charged: 24 });
    expect(calls).toEqual([{ fn: 'confirmToActual', args: [expect.objectContaining({ creditsReserved: 120 }), 24] }]);
  });
  test('0 completed -> full release, no charge', async () => {
    expect(await settleMarketPulseRun(handle(16) as any, 0)).toEqual({ charged: 0 });
    expect(calls.map((c) => c.fn)).toEqual(['release']);
  });
  test('never above the hold', async () => {
    await settleMarketPulseRun(handle(16) as any, 5);
    expect(calls[0].args[1]).toBe(16);
  });
});

describe('cadence (owner: weekly default, daily honoured)', () => {
  const now = new Date('2026-11-14T04:30:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  test.each([
    ['weekly', null, true], ['weekly', ago(24 * 6), false], ['weekly', ago(24 * 7), true], ['weekly', ago(24 * 7 - 0.5), true],
    ['daily', ago(23.5), true], ['daily', ago(20), false], ['daily', null, true],
    [undefined, ago(24 * 3), false], ['monthly', ago(24 * 3), false],
  ] as const)('cadence %p, last run %p -> due %p', (cadence, last, due) => {
    expect(isMarketPulseRunDue(cadence as any, last as any, now)).toBe(due);
  });
});

describe('processor settles the claimed job', () => {
  const job = (regions: string[], credits: number, status = 'PENDING') => ({
    id: JOB, company_id: ORG, status, regions,
    context_payload: { insight_source: 'llm', credit_reservation: handle(credits) },
  });

  test('a mid-run failure settles at actual (2 of 3 regions -> 16) and releases the rest', async () => {
    jobRow = job(['A', 'B', 'C'], 24);
    regionOutcome.B = 'fail';
    await processMarketPulseJobV1(JOB);
    expect(aiCalls).toEqual(['A', 'B', 'C']);
    expect(calls).toEqual([{ fn: 'confirmToActual', args: [expect.objectContaining({ creditsReserved: 24 }), 16] }]);
  });

  test('every region fails -> full release', async () => {
    jobRow = job(['A', 'B'], 16);
    regionOutcome.A = 'fail'; regionOutcome.B = 'fail';
    await processMarketPulseJobV1(JOB);
    expect(calls.map((c) => c.fn)).toEqual(['release']);
  });

  test('all regions complete -> charges the full hold', async () => {
    jobRow = job(['A', 'B'], 16);
    await processMarketPulseJobV1(JOB);
    expect(calls).toEqual([{ fn: 'confirmToActual', args: [expect.anything(), 16] }]);
  });

  test('a SECOND invocation (job already RUNNING) settles nothing - it can never release a hold in use', async () => {
    jobRow = job(['A'], 8, 'RUNNING');
    await processMarketPulseJobV1(JOB);
    expect(calls).toEqual([]);
    expect(aiCalls).toEqual([]);
  });

  test('cancelled before any region -> full release (nothing completed)', async () => {
    jobRow = job(['A', 'B'], 16);
    cancelled = false;
    // cancellation is observed at the first region check
    const orig = updates.push.bind(updates);
    let n = 0;
    updates.push = (x: any) => { n++; if (n === 1) cancelled = true; return orig(x); };
    await processMarketPulseJobV1(JOB);
    updates.push = orig;
    expect(aiCalls).toEqual([]);
    expect(calls.map((c) => c.fn)).toEqual(['release']);
  });

  test('constant: 8 credits per region', () => { expect(MARKET_PULSE_CREDITS_PER_REGION).toBe(8); });
});
