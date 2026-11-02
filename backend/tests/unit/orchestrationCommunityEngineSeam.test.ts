/**
 * The seam between the community adapter (journey side) and the community
 * engine after its safety remediation — integration owner, 2026-10-28.
 *
 *   1. The adapter holds the `approved → executing` claim, so it must ask the
 *      engine for a compare-and-set terminal write (`expected_from_statuses`).
 *   2. `deferred` = provably not acted; the engine set the row back to
 *      `approved` and queued its own durable retry. The step waits; it is never
 *      reported uncertain and never resubmitted by the adapter.
 *   3. `uncertain` from the engine = may have reached the platform → needs_human.
 */

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
}));

import {
  createCommunityAdapter, type CommunityActionRow, type CommunityAdapterDeps, type RequestRow,
} from '../../services/orchestration/communityEngineAdapter';
import { CONTRACT_ORG, contractContext, expectContractResult } from './helpers/engineAdapterContractKit';
import { provenIdentity } from './helpers/communityIdentityFixture';
import type { ExecutionResult } from '../../services/communityAiActionExecutor';

const ACTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-10-28T09:00:00.000Z';
const ctx = contractContext({ channel: 'community', personId: '77777777-7777-4777-8777-777777777777', now: NOW });

function world(engineResult: ExecutionResult, rowAfter: string) {
  const row: CommunityActionRow = {
    id: ACTION_ID, tenant_id: CONTRACT_ORG, organization_id: CONTRACT_ORG,
    platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:activity:123',
    suggested_text: 'Thanks for sharing this.', final_text: null, playbook_id: 'pb-1',
    requires_human_approval: true, risk_level: 'low', approved_at: '2026-10-28T08:00:00.000Z',
    status: 'approved', execution_mode: 'api', scheduled_at: null,
    execution_correlation_id: null, execution_result: null, intent_classification: null,
  };
  let req: RequestRow | null = null;
  const calls: Array<{ options: Record<string, unknown> | undefined }> = [];
  const deps: CommunityAdapterDeps = {
    async getOrCreateRequest() {
      req ??= { id: 'req-1', state: 'requested', external_ref: null, detail: null, updated_at: NOW };
      return { ...req };
    },
    async transitionRequest(_org, _task, from, patch) {
      if (!req || req.state !== from) return false;
      req = { ...req, state: patch.state, external_ref: patch.external_ref ?? req.external_ref, detail: patch.detail ?? req.detail, updated_at: NOW };
      return true;
    },
    // 20261231000006: identity is proven in its own suite; here it passes.
    binding: { resolve: async () => ({ kind: 'bound', actionId: ACTION_ID, identity: provenIdentity }) },
    async readAction(org, id) { return org === CONTRACT_ORG && id === ACTION_ID ? { ...row } : null; },
    async claimAction() {
      if (row.status !== 'approved') return false;
      row.status = 'executing';
      return true;
    },
    async preflight() { return { allowed: true }; },
    async channelPermitted() { return true; },
    executeAction: (async (_action: unknown, _approved: unknown, options?: Record<string, unknown>) => {
      calls.push({ options });
      row.status = rowAfter;
      return engineResult;
    }) as unknown as CommunityAdapterDeps['executeAction'],
  };
  return { deps, calls, req: () => req, row };
}

describe('community adapter × engine seam', () => {
  it('asks the engine for a compare-and-set terminal write from the claim it holds', async () => {
    const w = world({ ok: true, status: 'executed' } as unknown as ExecutionResult, 'executed');
    const a = createCommunityAdapter(w.deps);
    const r = await a.execute(ctx);
    expectContractResult(a, r);
    expect(r.disposition).toBe('completed');
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].options?.expected_from_statuses).toEqual(['executing']);
  });

  it('a deferred action waits for the engine\'s own retry — never uncertain, never resubmitted', async () => {
    const w = world({ ok: false, status: 'deferred', error: 'RPA_ENV_NOT_READY' } as unknown as ExecutionResult, 'approved');
    const a = createCommunityAdapter(w.deps);
    const first = await a.execute(ctx);
    expectContractResult(a, first);
    expect(first).toMatchObject({ outcome: 'deferred', disposition: 'wait' });
    expect(w.req()?.state).toBe('submitted');
    // Later sweeps observe the row (`approved` again) and never call the engine.
    for (let i = 0; i < 3; i++) {
      const again = await a.execute(ctx);
      expectContractResult(a, again);
      expect(again).toMatchObject({ outcome: 'deferred', disposition: 'wait' });
    }
    expect(w.calls).toHaveLength(1);
    // Once the engine's retry runs it, the step follows the row.
    w.row.status = 'executed';
    expect((await a.execute(ctx)).disposition).toBe('completed');
    expect(w.calls).toHaveLength(1);
  });

  it('an engine-reported uncertain outcome needs a person and is never re-executed', async () => {
    const w = world({ ok: false, status: 'uncertain', error: 'API_EXECUTION_TIMEOUT' } as unknown as ExecutionResult, 'uncertain');
    const a = createCommunityAdapter(w.deps);
    const r = await a.execute(ctx);
    expectContractResult(a, r);
    expect(r).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human' });
    expect(w.req()?.state).toBe('uncertain');
    expectContractResult(a, await a.execute(ctx));
    expect(w.calls).toHaveLength(1);
  });
});
