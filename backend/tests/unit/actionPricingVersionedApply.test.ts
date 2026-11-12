/**
 * Billing defect B-1 -- applyActionPricingChange is ONE call to the database function
 * apply_action_pricing_change (migration 20270210000000). The SQL semantics (atomicity,
 * scoping, carry/require source_type, grants) are proven against real PostgreSQL in
 * backend/tests/realschema/b1_action_pricing_versioned_apply.test.ts; this file pins the
 * caller: what it sends, how it maps refusals, and that a blank answer is never success.
 */
const rpc = jest.fn();
const refresh = jest.fn().mockResolvedValue(undefined);
const tableCalls: string[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
  ownedDbTable: (t: string) => { tableCalls.push(t); throw new Error(`direct table write to ${t} is forbidden on this path`); },
}));
jest.mock('../../services/pricingService', () => ({ refreshPricingCache: () => refresh() }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { applyActionPricingChange, applyModelPricingChange, ActionPricingInputError } from '../../services/actionPricingApplyService';

beforeEach(() => { rpc.mockReset(); refresh.mockClear(); tableCalls.length = 0; });

describe('applyActionPricingChange (B-1)', () => {
  it('makes exactly ONE rpc call with every argument, never a direct table write', async () => {
    rpc.mockResolvedValue({ data: 'new-id', error: null });
    const r = await applyActionPricingChange({
      actionKey: 'content_basic', costMultiplier: 1.25, minimumChargeUsd: 0.01, ceilingUsd: 2,
      notes: 'n', effectiveFrom: '2026-11-10T00:00:00.000Z', sourceType: 'llm',
    });
    expect(r).toEqual({ id: 'new-id' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('apply_action_pricing_change', {
      p_action_key: 'content_basic', p_cost_multiplier: 1.25, p_minimum_charge_usd: 0.01, p_ceiling_usd: 2,
      p_effective_from: '2026-11-10T00:00:00.000Z', p_notes: 'n', p_source_type: 'llm',
    });
    expect(tableCalls).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('omitted optionals are sent as null/0 so the function carries source_type from the prior row', async () => {
    rpc.mockResolvedValue({ data: 'id2', error: null });
    await applyActionPricingChange({ actionKey: 'ai_reply', costMultiplier: 1 });
    const args = rpc.mock.calls[0][1];
    expect(args.p_source_type).toBeNull();
    expect(args.p_minimum_charge_usd).toBe(0);
    expect(args.p_ceiling_usd).toBeNull();
    expect(args.p_notes).toBeNull();
    expect(typeof args.p_effective_from).toBe('string');
  });

  it.each([
    ['22023', 'source_type is required for action_key x (it has no active row to carry it from)'],
    ['23514', 'new row violates check constraint "action_pricing_config_source_type_check"'],
  ])('FAIL input: database refusal %s maps to ActionPricingInputError (HTTP 400 at the boundary)', async (code, message) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    await expect(applyActionPricingChange({ actionKey: 'x', costMultiplier: 1 })).rejects.toBeInstanceOf(ActionPricingInputError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('FAIL input: any other database error is a platform failure, not an input error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'serialization failure' } });
    const p = applyActionPricingChange({ actionKey: 'x', costMultiplier: 1 });
    await expect(p).rejects.toThrow('Failed to apply pricing change');
    await expect(applyActionPricingChange({ actionKey: 'x', costMultiplier: 1 })).rejects.not.toBeInstanceOf(ActionPricingInputError);
  });

  it.each<[{ data: unknown; error: unknown }, string]>([
    [{ data: null, error: null }, 'null data'],
    [{ data: '', error: null }, 'empty string'],
    [{ data: { id: 'x' }, error: null }, 'an object instead of the uuid'],
  ])('FAIL input: a blank or malformed answer (%s) is NOT success', async (resp) => {
    rpc.mockResolvedValue(resp);
    await expect(applyActionPricingChange({ actionKey: 'x', costMultiplier: 1 })).rejects.toThrow('returned no row id');
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('applyModelPricingChange (B-1 follow-up)', () => {
  it('makes exactly ONE rpc call to apply_model_pricing_change, never a direct table write', async () => {
    rpc.mockResolvedValue({ data: 'm-id', error: null });
    const r = await applyModelPricingChange({
      provider: 'openai', modelName: 'gpt-x', kind: 'completion', inputPer1kUsd: 0.5, outputPer1kUsd: 1.5,
      effectiveFrom: '2026-11-10T00:00:00.000Z', notes: 'n',
    });
    expect(r).toEqual({ id: 'm-id' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('apply_model_pricing_change', {
      p_provider: 'openai', p_model_name: 'gpt-x', p_kind: 'completion', p_input_per_1k_usd: 0.5, p_output_per_1k_usd: 1.5,
      p_effective_from: '2026-11-10T00:00:00.000Z', p_notes: 'n', p_max_context_tokens: null, p_max_output_tokens: null,
    });
    expect(tableCalls).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('FAIL input: a kind the CHECK rejects (23514) is an input error, and the cache is not refreshed', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'llm_model_pricing_kind_check' } });
    await expect(applyModelPricingChange({ provider: 'p', modelName: 'm', kind: 'bogus', inputPer1kUsd: 0, outputPer1kUsd: 0 }))
      .rejects.toBeInstanceOf(ActionPricingInputError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('FAIL input: a blank answer is NOT success', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(applyModelPricingChange({ provider: 'p', modelName: 'm', kind: 'completion', inputPer1kUsd: 0, outputPer1kUsd: 0 }))
      .rejects.toThrow('returned no row id');
  });
});
