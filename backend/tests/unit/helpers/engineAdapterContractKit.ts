/**
 * Shared contract checks for orchestration engine adapters.
 *
 * Every adapter suite calls `expectContractResult` on EVERY result it observes,
 * and runs `contractScenarios` once, so all engines are held to the same rules
 * (engineAdapters.ts, "THE ADAPTER CONTRACT"). Owned by the integration owner;
 * adapter workstreams use it and do not change it.
 */

import type {
  EngineAdapter, EngineDisposition, EngineResult, EngineStepContext,
} from '../../../services/orchestration/engineAdapters';
import { ENGINE_NAMES } from '../../../services/orchestration/engineAdapters';

export const DISPOSITIONS: readonly EngineDisposition[] = ['completed', 'skipped', 'wait', 'needs_human'];

export const CONTRACT_ORG = '11111111-1111-4111-8111-111111111111';
export const CONTRACT_OTHER_ORG = '22222222-2222-4222-8222-222222222222';

/** A ready step's context; override what the scenario needs. */
export function contractContext(overrides: Partial<EngineStepContext> = {}): EngineStepContext {
  return {
    organizationId: CONTRACT_ORG,
    executionInstanceId: '33333333-3333-4333-8333-333333333333',
    executionTaskId: '44444444-4444-4444-8444-444444444444',
    planStepId: '55555555-5555-4555-8555-555555555555',
    channel: 'content',
    subject: { kind: 'prospect', id: '66666666-6666-4666-8666-666666666666' },
    step: null,
    personId: null,
    now: '2026-10-28T09:00:00.000Z',
    ...overrides,
  };
}

/** The shape every result must have, whatever happened. */
export function expectContractResult(adapter: EngineAdapter, r: EngineResult): void {
  expect(ENGINE_NAMES).toContain(adapter.engine);
  expect(r.engine).toBe(adapter.engine);
  expect(DISPOSITIONS).toContain(r.disposition);
  expect(typeof r.outcome).toBe('string');
  expect(r.outcome.length).toBeGreaterThan(0);
  expect(r.externalRef === null || (typeof r.externalRef === 'string' && r.externalRef.length > 0)).toBe(true);
  // Anything short of completion must say why.
  if (r.disposition !== 'completed') expect(typeof r.reason === 'string' && r.reason.length > 0).toBe(true);
  // An action that may have happened is never left for an automatic retry.
  if (r.outcome === 'uncertain') expect(r.disposition).toBe('needs_human');
}

/**
 * The scenarios every adapter must satisfy. The adapter suite supplies a factory
 * whose fake engine/ledger behaves as described by each hook.
 */
export interface ContractHarness {
  /** A fresh adapter over a fresh fake engine and ledger. */
  make(): EngineAdapter;
  /** How many external actions the fake engine has performed so far. */
  externalActions(): number;
  /** Make the NEXT engine call time out / crash AFTER it may have acted. */
  failAfterCall(): void;
  /** Make the engine's own gate refuse (permission, approval, kill switch, …). */
  refuseByGate(): void;
}

export async function contractScenarios(h: ContractHarness, ctx: EngineStepContext): Promise<void> {
  // 1. Repeating execute for the same task never causes a second external action.
  {
    const a = h.make();
    const first = await a.execute(ctx);
    expectContractResult(a, first);
    const before = h.externalActions();
    for (let i = 0; i < 3; i++) expectContractResult(a, await a.execute(ctx));
    expect(h.externalActions()).toBe(before);
  }
  // 2. A call that may have acted is `uncertain` + `needs_human`, and is not retried.
  {
    const a = h.make();
    h.failAfterCall();
    const r = await a.execute(ctx);
    expectContractResult(a, r);
    expect(r.disposition).toBe('needs_human');
    const actions = h.externalActions();
    expectContractResult(a, await a.execute(ctx));
    expect(h.externalActions()).toBe(actions);
  }
  // 3. An engine gate refusal is reported, never retried around, and acts on nothing.
  {
    const a = h.make();
    h.refuseByGate();
    const before = h.externalActions();
    const r = await a.execute(ctx);
    expectContractResult(a, r);
    expect(['needs_human', 'skipped', 'wait']).toContain(r.disposition);
    expect(h.externalActions()).toBe(before);
  }
}
