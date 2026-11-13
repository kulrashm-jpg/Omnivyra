/**
 * C75 (e1 2026-11-13): the creator scheduler's per-row generation is ONE billed unit - dark unless enforced,
 * token-metered, identity per campaign/row/plan version, reclaim on a released slot, never re-run for free.
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
const mockAnomalies: any[] = [];
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: (a: unknown) => { mockAnomalies.push(a); } }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import {
  generateCreatorRowBilled, creatorRowIdentity, CreatorRowBillingRefusedError,
  MAX_CREATOR_ROW_RECLAIM_ATTEMPTS, CREATOR_ROW_ACTION, CREATOR_ROW_UNIT_CALLS,
} from '../../services/billing/creatorRowGenerationBilling';
import { classifyCreatorFailure } from '../../services/structuredPlanSchedulerModel';
import { RECLAIM_CASES, EXHAUSTED_CASE, RECLAIM_CAP } from '../helpers/reclaimSemanticsCases';

const BASE = { companyId: 'org-1', userId: 'u-1', campaignId: 'c-1', rowId: 'row-1', planVersion: 3, stash: undefined as unknown };
const keyFor = (slot: number) => {
  const id = creatorRowIdentity('c-1', 'row-1', 3);
  return `org-1|${CREATOR_ROW_ACTION}|${slot === 0 ? id : `${id}:r${slot}`}`;
};

beforeEach(() => {
  ledger.clear(); charges = 0; mockAnomalies.length = 0; mockMode = 'enforce';
  mockEngine.executeWithEntryConsumption.mockClear();
});

describe('not enforced: today\'s path', () => {
  it.each(['off', 'shadow'])('mode %s runs generate() once, no engine call, nothing billed', async (m) => {
    mockMode = m;
    const generate = jest.fn(async () => ({ out: 1 }));
    expect(await generateCreatorRowBilled({ ...BASE, generate })).toEqual({ billed: false, reused: false, output: { out: 1 } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
  });
  it('a stash is ignored when not enforced (no reuse path is taken)', async () => {
    mockMode = 'off';
    const generate = jest.fn(async () => ({ out: 2 }));
    const r = await generateCreatorRowBilled({ ...BASE, stash: { plan_version: 3, reference_id: 'x', output: { old: true } }, generate });
    expect(r.output).toEqual({ out: 2 });
  });
});

describe('enforced', () => {
  it('a fresh row is ONE token-metered unit: content_generation, hold scaled by the unit\'s calls, stash returned', async () => {
    const generate = jest.fn(async () => ({ out: 'A' }));
    const r = await generateCreatorRowBilled({ ...BASE, generate });
    expect(r).toEqual({ billed: true, reused: false, output: { out: 'A' }, stash: { plan_version: 3, reference_id: creatorRowIdentity('c-1', 'row-1', 3), output: { out: 'A' } } });
    const opts = mockEngine.executeWithEntryConsumption.mock.calls[0][0];
    expect(opts).toMatchObject({
      orgId: 'org-1', userId: 'u-1', action: 'content_generation', referenceType: 'creator_daily_plan_row',
      referenceId: 'creator_row:c-1:row-1:v3', collectViaCollector: true, validateMembership: false,
      llmPricing: { actionKey: 'content_generation', maxInputTokens: 8000 * CREATOR_ROW_UNIT_CALLS, maxOutputTokens: 2000 * CREATOR_ROW_UNIT_CALLS },
    });
    expect(charges).toBe(1);
  });

  it('a stash for the SAME plan version is reused: no AI, no engine call, no charge', async () => {
    const generate = jest.fn();
    const r = await generateCreatorRowBilled({ ...BASE, stash: { plan_version: 3, reference_id: 'creator_row:c-1:row-1:v3', output: { out: 'S' } }, generate });
    expect(r).toEqual({ billed: true, reused: true, output: { out: 'S' } });
    expect(generate).not.toHaveBeenCalled();
    expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
  });

  it('a stash for an OLDER plan version is not reused (new plan = new content = new charge)', async () => {
    const generate = jest.fn(async () => ({ out: 'N' }));
    const r = await generateCreatorRowBilled({ ...BASE, stash: { plan_version: 2, reference_id: 'creator_row:c-1:row-1:v2', output: { out: 'old' } }, generate });
    expect(r.output).toEqual({ out: 'N' });
    expect(charges).toBe(1);
  });

  it('settled with NO stash: never re-run, critical charged_no_output anomaly, permanent typed refusal', async () => {
    ledger.set(keyFor(0), 'settled');
    const generate = jest.fn();
    const err = await generateCreatorRowBilled({ ...BASE, generate }).catch((e) => e);
    expect(err).toBeInstanceOf(CreatorRowBillingRefusedError);
    expect(err).toMatchObject({ code: 'CHARGED_NO_OUTPUT', retryable: false });
    expect(generate).not.toHaveBeenCalled();
    expect(mockAnomalies).toEqual([expect.objectContaining({ kind: 'charged_no_output', severity: 'critical', organizationId: 'org-1' })]);
  });

  it('a failed generation releases its slot; the retry runs in the next slot and is charged once', async () => {
    const generate = jest.fn().mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce({ out: 'R' });
    await expect(generateCreatorRowBilled({ ...BASE, generate })).rejects.toThrow('provider down');
    const r = await generateCreatorRowBilled({ ...BASE, generate });
    expect(r.output).toEqual({ out: 'R' });
    expect(mockEngine.executeWithEntryConsumption.mock.calls.at(-1)![0].referenceId).toBe('creator_row:c-1:row-1:v3:r1');
    expect(charges).toBe(1);
  });

  it.each([
    [{ status: 'insufficient_credits', available: 1, required: 9 }, 'INSUFFICIENT_CREDITS', true],
    [{ status: 'no_credit_account' }, 'NO_CREDIT_ACCOUNT', false],
    [{ status: 'org_control_blocked', code: 'DAILY_LIMIT_EXCEEDED', reason: 'x' }, 'ORG_CONTROL_BLOCKED', true],
    [{ status: 'org_control_blocked', code: 'ORG_BLOCKED', reason: 'x' }, 'ORG_CONTROL_BLOCKED', false],
    [{ status: 'not_a_member', userId: 'u', orgId: 'o' }, 'NOT_A_MEMBER', false],
  ])('engine %j -> typed refusal %s (retryable %s), nothing generated', async (res, code, retryable) => {
    mockEngine.executeWithEntryConsumption.mockResolvedValueOnce(res as any);
    const generate = jest.fn();
    const err = await generateCreatorRowBilled({ ...BASE, generate }).catch((e) => e);
    expect(err).toMatchObject({ code, retryable });
    expect(generate).not.toHaveBeenCalled();
  });

  it('a campaign with no company is refused when enforced - never free AI', async () => {
    const generate = jest.fn();
    const err = await generateCreatorRowBilled({ ...BASE, companyId: null, generate }).catch((e) => e);
    expect(err).toMatchObject({ code: 'NO_CREDIT_ACCOUNT', retryable: false });
    expect(generate).not.toHaveBeenCalled();
  });

  it('refusal messages never look transient to the message classifier (the scheduler uses the typed flag anyway)', async () => {
    mockEngine.executeWithEntryConsumption.mockResolvedValueOnce({ status: 'insufficient_credits', available: 0, required: 9 } as any);
    const err = await generateCreatorRowBilled({ ...BASE, generate: jest.fn() }).catch((e) => e);
    expect(classifyCreatorFailure(err)).toBe('permanent');
  });
});

describe('the shared reclaim semantics table', () => {
  it('the cap equals the shared table', () => { expect(MAX_CREATOR_ROW_RECLAIM_ATTEMPTS).toBe(RECLAIM_CAP); });
  for (const c of [...RECLAIM_CASES, EXHAUSTED_CASE]) {
    it(c.name, async () => {
      c.slots.forEach((st, i) => { if (st) ledger.set(keyFor(i), st); });
      const generate = jest.fn(async () => ({ out: 'T' }));
      const out = await generateCreatorRowBilled({ ...BASE, generate }).then(() => 'ran', (e) => e);
      if (c.expect === 'processed') {
        expect(out).toMatchObject({ code: 'CHARGED_NO_OUTPUT' });
        expect(generate).not.toHaveBeenCalled();
      } else if (c.expect === 'exhausted') {
        expect(out).toMatchObject({ code: 'RECLAIM_CAP_EXHAUSTED', retryable: false });
        expect(generate).not.toHaveBeenCalled();
        expect(mockAnomalies).toEqual([expect.objectContaining({ kind: 'reclaim_cap_exhausted', severity: 'critical' })]);
      } else {
        const slot = Number(c.expect.split(':')[1]);
        expect(out).toBe('ran');
        expect(generate).toHaveBeenCalledTimes(1);
        expect(charges).toBe(1);
        const used = mockEngine.executeWithEntryConsumption.mock.calls.at(-1)![0].referenceId as string;
        expect(slot === 0 ? !/:r\d+$/.test(used) : used.endsWith(`:r${slot}`)).toBe(true);
      }
    });
  }
});
