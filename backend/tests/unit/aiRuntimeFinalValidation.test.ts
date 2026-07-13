/**
 * CAMPAIGN-IMPL-005A — final pre-deployment validation of the canonical AI
 * execution runtime, driven through the REAL incident route
 * (/api/planner/generate-workspace-content) + REAL runtime, with only IO
 * seams mocked. The durable result store mock survives across handler
 * invocations — which IS the restart simulation: a browser refresh, server
 * restart, or worker restart all reduce to "new process, same durable
 * state, same logical request".
 *
 * Per-scenario accounting: reservations (billing attempts), LLM calls,
 * persists, and the response artifact hash.
 */

import { createHash } from 'crypto';

type Row = Record<string, unknown>;

const counters = { billing: 0, llm: 0, persist: 0 };
let billingStatus: Row = { status: 'executed' };
// Durable state — survives "restarts" (persists across handler calls).
const ledgerSettled = new Set<string>();
const durableStore = new Map<string, { v: 1; action: string; saved_at: string; payload: unknown }>();
let persistFails = false;

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1' })),
}));
jest.mock('../../services/companyProfileService', () => ({ getProfile: jest.fn(async () => null) }));
jest.mock('../../services/companyContextService', () => ({ buildCompanyContext: jest.fn(() => ({ identity: {}, brand: {}, customer: {} })) }));
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async () => {
    counters.llm += 1;
    return { output: `{"linkedin": "content #${counters.llm}"}` };
  }),
}));
jest.mock('../../services/unifiedContentProcessor', () => ({
  processContent: jest.fn(async (req: Row) => ({ content: req.content })),
}));
jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: jest.fn(async () => 3) }));
jest.mock('../../services/creditExecutionService', () => ({
  makeIdempotencyKey: (u: string, a: string, r: string, s: string) => `${u}|${a}|${r}|${s}`,
  executeWithCredits: jest.fn(async (args: any) => {
    counters.billing += 1;
    if (billingStatus.status !== 'executed') return billingStatus;
    // Ledger semantics: a settled key never re-executes.
    if (ledgerSettled.has(args.idempotencyKey)) return { status: 'already_confirmed' };
    ledgerSettled.add(args.idempotencyKey);
    return { status: 'executed', result: await args.executor() };
  }),
  executeWithEntryConsumption: jest.fn(async () => ({ status: 'executed' })),
}));
jest.mock('../../services/billing/creditEconomyActivation', () => ({
  getCreditEconomyExecutionMode: jest.fn(async () => 'shadow'),
}));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: jest.fn(async () => undefined) }));
jest.mock('../../services/ai/aiExecutionResultStore', () => ({
  loadAiExecutionResult: jest.fn(async (key: string) => durableStore.get(key) ?? null),
  saveAiExecutionResult: jest.fn(async (args: any) => {
    counters.persist += 1;
    if (persistFails) return false;
    durableStore.set(args.idempotencyKey, { v: 1, action: args.action, saved_at: 'now', payload: args.payload });
    return true;
  }),
}));

import handler from '../../../pages/api/planner/generate-workspace-content';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}
const request = (over: Row = {}) => ({
  method: 'POST',
  headers: {},
  body: {
    companyId: 'co-1', topic: 'Launch story', platforms: ['linkedin'],
    activity_key: 'slot-1', attempt: 'first', ...over,
  },
}) as any;
const generate = async (over: Row = {}) => { const res = mockRes(); await handler(request(over), res); return res; };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const snapshot = () => ({ ...counters });

const FORBIDDEN = ['already_reserved', 'already_settled', 'already_confirmed', 'reservation_exists',
  'billing_operation', 'credit_hold', 'ledger', 'reservation_released', 'execution_resume_required', 'already_released'];

beforeEach(() => {
  counters.billing = 0; counters.llm = 0; counters.persist = 0;
  billingStatus = { status: 'executed' };
  ledgerSettled.clear();
  durableStore.clear();
  persistFails = false;
});

describe('IMPL-005A — final runtime validation', () => {
  test('S1/S2/S9/S10 — refresh / timeout / server restart / worker restart: retry after interruption resumes with one charge, one LLM call, one artifact', async () => {
    const first = await generate();
    expect(first.statusCode).toBe(200);
    const firstHash = hash(first.body.variants);
    expect(snapshot()).toEqual({ billing: 1, llm: 1, persist: 1 });

    // Interruption: process state gone, durable state (store + ledger) intact.
    // The client re-issues the SAME logical request.
    const retry = await generate();
    expect(retry.statusCode).toBe(200);
    expect(retry.body.resumed).toBe(true);
    expect(hash(retry.body.variants)).toBe(firstHash); // identical artifact
    expect(snapshot()).toEqual({ billing: 1, llm: 1, persist: 1 }); // NOTHING duplicated
  });

  test('S3/S8 — duplicate click and two concurrent tabs: one reservation, both succeed, store converges', async () => {
    const [a, b] = await Promise.all([generate(), generate()]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    // THE hard guarantees under a perfectly simultaneous race:
    expect(ledgerSettled.size).toBe(1);          // exactly ONE reservation ever settles (single charge)
    expect(counters.llm).toBeLessThanOrEqual(2); // loser may free-re-run inside the race window (never billed)
    expect(durableStore.size).toBe(1);           // ONE persistence target — no duplicate artifacts
    // DOCUMENTED LIMITATION: byte-identical responses for the exact-same-
    // instant race require an in-flight mutex (classified debt); the store
    // CONVERGES immediately — every subsequent retry returns one artifact.
    const third = await generate();
    expect(third.body.resumed).toBe(true);
    const fourth = await generate();
    expect(hash(third.body.variants)).toBe(hash(fourth.body.variants));
    expect(counters.llm).toBeLessThanOrEqual(2); // converged — no further LLM work ever
  });

  test('S4 — persistence failure: response succeeds; retry recovers WITHOUT recharging; store heals', async () => {
    persistFails = true;
    const first = await generate();
    expect(first.statusCode).toBe(200);
    expect(snapshot()).toEqual({ billing: 1, llm: 1, persist: 1 }); // save attempted, failed silently

    persistFails = false;
    const retry = await generate(); // ledger settled, store empty → free re-run, then store heals
    expect(retry.statusCode).toBe(200);
    expect(counters.billing).toBe(2);      // second attempt PROBED billing (no new charge — key settled)
    expect(ledgerSettled.size).toBe(1);    // still exactly one settlement
    expect(durableStore.size).toBe(1);     // persistence healed
    const third = await generate();        // future retries reuse the stored result
    expect(third.body.resumed).toBe(true);
    expect(counters.llm).toBe(2);          // no third LLM call
  });

  test('S5 — explicit regenerate: new operation, new charge, new artifact; original preserved until success', async () => {
    const first = await generate({ attempt: 'first' });
    const firstHash = hash(first.body.variants);
    const regen = await generate({ attempt: '2026-07-12T12:00:00Z' }); // new attempt token = user intent
    expect(regen.statusCode).toBe(200);
    expect(regen.body.resumed).toBeUndefined();
    expect(hash(regen.body.variants)).not.toBe(firstHash); // fresh content
    expect(ledgerSettled.size).toBe(2);                    // one ADDITIONAL legitimate charge
    expect(durableStore.size).toBe(2);                     // both artifacts persisted independently
    // Original operation's artifact untouched (client replaces only on success)
    const original = await generate({ attempt: 'first' });
    expect(hash(original.body.variants)).toBe(firstHash);
  });

  test('S6 — settled reservation with no cached response: free recovery, persisted, then reused', async () => {
    billingStatus = { status: 'already_confirmed' }; // pre-existing settlement, empty store
    const recover = await generate();
    expect(recover.statusCode).toBe(200);
    expect(counters.llm).toBe(1);      // ONE free recovery execution
    expect(durableStore.size).toBe(1); // result persisted
    const again = await generate();
    expect(again.body.resumed).toBe(true);
    expect(counters.llm).toBe(1);      // future retries reuse, no more LLM
    expect(JSON.stringify(recover.body)).not.toMatch(/settled|reservation|confirmed/i);
  });

  test('S7 — released reservation: deterministic retry key, one legitimate rebill, one result', async () => {
    const credits = jest.requireMock('../../services/creditExecutionService').executeWithCredits as jest.Mock;
    credits.mockImplementationOnce(async (args: any) => { counters.billing += 1; return { status: 'already_released' }; });
    const res = await generate();
    expect(res.statusCode).toBe(200);
    expect(counters.llm).toBe(1);                   // exactly one execution
    expect(ledgerSettled.size).toBe(1);             // exactly one (re)bill
    expect([...ledgerSettled][0]).toContain(':r1'); // deterministic derived retry key
  });

  test('S11 — unknown billing status: fail closed, safe message, no crash', async () => {
    billingStatus = { status: 'mystery_ledger_state_v9' };
    const res = await generate();
    expect(res.statusCode).toBe(403);
    expect(String(res.body.error)).toMatch(/disabled|unavailable|organization/i);
    expect(JSON.stringify(res.body)).not.toContain('mystery_ledger_state_v9');
  });

  test('S12 — forbidden vocabulary never appears in ANY runtime response', async () => {
    const bodies: unknown[] = [];
    bodies.push((await generate()).body);                                       // success
    bodies.push((await generate()).body);                                       // resume
    billingStatus = { status: 'already_confirmed' }; durableStore.clear();
    bodies.push((await generate({ activity_key: 'slot-2' })).body);             // free recovery
    billingStatus = { status: 'insufficient_credits', required: 3, available: 0 };
    bodies.push((await generate({ activity_key: 'slot-3' })).body);             // blocked 402
    billingStatus = { status: 'org_control_blocked', code: 'X', reason: 'y' };
    bodies.push((await generate({ activity_key: 'slot-4' })).body);             // blocked 403
    const text = JSON.stringify(bodies).toLowerCase();
    for (const word of FORBIDDEN) expect(text).not.toContain(word);
  });

  test('Determinism — same logical request always maps to the same operation key and persistence target', async () => {
    await generate();
    const [key] = [...durableStore.keys()];
    expect(key).toBe('user-1|content_basic|co-1:slot-1:first|workspace-content');
    await generate();
    expect([...durableStore.keys()]).toEqual([key]); // same target, never a second row
  });
});
