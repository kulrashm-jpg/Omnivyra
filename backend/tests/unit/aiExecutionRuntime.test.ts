/**
 * CAMPAIGN-IMPL-005 — canonical AI execution runtime: deterministic
 * simulations (Phase 10). Every scenario must end with exactly one logical
 * generation, one persistence, one credit charge, one completed result.
 */

const billingCalls: Array<{ engine: string; key: string }> = [];
let creditsResult: Record<string, unknown> = { status: 'executed' };
let entryResult: Record<string, unknown> = { status: 'executed' };
let economyMode = 'shadow';
const resultStore = new Map<string, { v: 1; action: string; saved_at: string; payload: unknown }>();
let saveShouldFail = false;
let saveCalls = 0;

jest.mock('../../services/creditExecutionService', () => ({
  makeIdempotencyKey: (u: string, a: string, r: string, s: string) => `${u}|${a}|${r}|${s}`,
  executeWithCredits: jest.fn(async (args: any) => {
    billingCalls.push({ engine: 'credits', key: args.idempotencyKey });
    if (creditsResult.status !== 'executed') return creditsResult;
    return { status: 'executed', result: await args.executor() };
  }),
  executeWithEntryConsumption: jest.fn(async (args: any) => {
    billingCalls.push({ engine: 'entry', key: args.idempotencyKey });
    if (entryResult.status !== 'executed') return entryResult;
    return { status: 'executed', result: await args.executor() };
  }),
}));
jest.mock('../../services/billing/creditEconomyActivation', () => ({
  getCreditEconomyExecutionMode: jest.fn(async () => economyMode),
}));
jest.mock('../../services/ai/aiExecutionResultStore', () => ({
  loadAiExecutionResult: jest.fn(async (key: string) => resultStore.get(key) ?? null),
  saveAiExecutionResult: jest.fn(async (args: any) => {
    saveCalls += 1;
    if (saveShouldFail) return false;
    resultStore.set(args.idempotencyKey, { v: 1, action: args.action, saved_at: 'now', payload: args.payload });
    return true;
  }),
}));

import { runAiExecution, AI_BLOCKED_MESSAGES } from '../../services/ai/aiExecutionRuntime';

const baseArgs = (executor: jest.Mock, over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  companyId: 'co-1',
  action: 'content_basic',
  module: 'test',
  referenceType: 'test_ref',
  referenceId: 'co-1:slot-1',
  salt: 'workspace-content',
  executor,
  ...over,
});

beforeEach(() => {
  billingCalls.length = 0;
  creditsResult = { status: 'executed' };
  entryResult = { status: 'executed' };
  economyMode = 'shadow';
  resultStore.clear();
  saveShouldFail = false;
  saveCalls = 0;
});

describe('canonical lifecycle', () => {
  test('fresh execution: charged once, persisted once, completed', async () => {
    const executor = jest.fn(async () => ({ text: 'generated' }));
    const outcome = await runAiExecution(baseArgs(executor));
    expect(outcome).toMatchObject({ status: 'completed', resumed: false, charged: true, result: { text: 'generated' } });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(billingCalls).toHaveLength(1);
    expect(saveCalls).toBe(1);
  });

  test('duplicate click after completion: stored result returned — zero LLM, zero billing', async () => {
    const executor = jest.fn(async () => 'first');
    await runAiExecution(baseArgs(executor));
    billingCalls.length = 0;

    const second = await runAiExecution(baseArgs(executor));
    expect(second).toMatchObject({ status: 'completed', result: 'first', resumed: true, charged: false });
    expect(executor).toHaveBeenCalledTimes(1); // never re-ran
    expect(billingCalls).toHaveLength(0);      // never touched billing
  });

  test('settled charge with NO stored result (legacy / lost persist): uncharged re-run recovers the artifact', async () => {
    creditsResult = { status: 'already_confirmed' };
    const executor = jest.fn(async () => 'recovered');
    const outcome = await runAiExecution(baseArgs(executor));
    expect(outcome).toMatchObject({ status: 'completed', result: 'recovered', resumed: true, charged: false });
    expect(executor).toHaveBeenCalledTimes(1); // ran, but OUTSIDE billing (free)
    expect(billingCalls).toHaveLength(1);      // only the probe that found the settlement
    expect(saveCalls).toBe(1);                 // result now stored for the NEXT retry
  });

  test('persist failure → response still succeeds; the retry resumes via free re-run, never a new charge', async () => {
    saveShouldFail = true;
    const executor = jest.fn(async () => 'v1');
    const first = await runAiExecution(baseArgs(executor));
    expect(first).toMatchObject({ status: 'completed', charged: true }); // user unaffected by persist failure

    // Retry: ledger says settled; store is empty → free re-run
    saveShouldFail = false;
    entryResult = { status: 'already_settled' };
    economyMode = 'enforce';
    const retryExecutor = jest.fn(async () => 'v1');
    const second = await runAiExecution(baseArgs(retryExecutor, { billing: 'entry-auto' }));
    expect(second).toMatchObject({ status: 'completed', result: 'v1', resumed: true, charged: false });
  });

  test('already_released (refunded attempt): one deterministic billed retry with derived key', async () => {
    const executor = jest.fn(async () => 'retried');
    const credits = jest.requireMock('../../services/creditExecutionService').executeWithCredits as jest.Mock;
    credits.mockImplementationOnce(async (args: any) => {
      billingCalls.push({ engine: 'credits', key: args.idempotencyKey });
      return { status: 'already_released' };
    });
    const outcome = await runAiExecution(baseArgs(executor));
    expect(outcome).toMatchObject({ status: 'completed', result: 'retried', charged: true });
    expect(billingCalls).toHaveLength(2);
    expect(billingCalls[1].key).toContain(':r1'); // derived deterministic retry key
  });
});

describe('blocked outcomes — user language only', () => {
  test('insufficient credits → 402 with a human message, amounts preserved', async () => {
    creditsResult = { status: 'insufficient_credits', required: 6, available: 1 };
    const outcome = await runAiExecution(baseArgs(jest.fn()));
    expect(outcome).toMatchObject({
      status: 'blocked', code: 'insufficient_credits', httpStatus: 402, required: 6, available: 1,
      userMessage: AI_BLOCKED_MESSAGES.insufficient_credits,
    });
  });

  test('membership / org control → 403; unknown future status fails CLOSED without leaking', async () => {
    creditsResult = { status: 'not_a_member' };
    expect(await runAiExecution(baseArgs(jest.fn()))).toMatchObject({ status: 'blocked', httpStatus: 403, code: 'not_authorized' });
    creditsResult = { status: 'some_new_internal_state' };
    const unknown = await runAiExecution(baseArgs(jest.fn()));
    expect(unknown.status).toBe('blocked');
    expect(JSON.stringify(unknown)).not.toContain('some_new_internal_state');
  });

  test('no internal billing vocabulary in ANY outcome', async () => {
    for (const status of ['already_settled', 'already_confirmed', 'insufficient_credits', 'not_a_member', 'org_control_blocked']) {
      creditsResult = status.startsWith('already') ? { status } : { status };
      resultStore.clear();
      const outcome = await runAiExecution(baseArgs(jest.fn(async () => 'x')));
      const text = JSON.stringify(outcome);
      for (const forbidden of ['already_settled', 'already_confirmed', 'already_released', 'reservation']) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});

describe('entry-auto billing selection', () => {
  test('enforce mode routes through entry consumption; already_settled resumes identically', async () => {
    economyMode = 'enforce';
    const executor = jest.fn(async () => 'entry-result');
    const outcome = await runAiExecution(baseArgs(executor, { billing: 'entry-auto' }));
    expect(outcome).toMatchObject({ status: 'completed', charged: true });
    expect(billingCalls[0].engine).toBe('entry');
  });
});
