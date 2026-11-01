/**
 * Browser (Playwright/RPA) engine adapter — refuses every request.
 *
 * The real engine entry points (RPA worker, runner, env probe, community
 * executor, playwright itself) are replaced by fakes that COUNT calls and can be
 * made to hang, crash or act. The adapter must reach none of them in any
 * scenario. No browser is launched and no site is touched.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

const engine = {
  actions: 0,
  mode: 'ok' as 'ok' | 'hang' | 'crash_after_act' | 'ambiguous' | 'gate_refuses',
};
const act = async () => {
  if (engine.mode === 'gate_refuses') return { success: false, error: 'RPA_DEFERRED:BLOCKED' };
  if (engine.mode === 'hang') return new Promise(() => undefined);
  engine.actions += 1;
  if (engine.mode === 'crash_after_act') throw new Error('browser crashed after submit');
  if (engine.mode === 'ambiguous') return { success: false, error: 'RPA_POST_CONDITION_FAILED' };
  return { success: true };
};

jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => act()),
  rpaSchedulerHooks: { observeBackpressure: jest.fn(), flushRetries: jest.fn(() => act()) },
}));
jest.mock('../../services/rpaWorker/rpaPlaywrightRunner', () => ({ runRpaScript: jest.fn(() => act()) }));
jest.mock('../../services/rpaWorker/rpaEnv', () => ({
  rpaEnvReady: jest.fn(async () => ({ ok: true })),
  isProbeFailure: jest.fn(() => false),
  assertRpaEnvReady: jest.fn(),
}));
jest.mock('../../services/rpaWorker/rpaRetryQueue', () => ({ enqueueRpaRetry: jest.fn(() => act()) }));
jest.mock('../../services/communityAiActionExecutor', () => ({ executeAction: jest.fn(() => act()) }));
jest.mock('playwright', () => ({ chromium: { launch: jest.fn(() => act()) } }));

import { executeRpaTask, rpaSchedulerHooks } from '../../services/rpaWorker/rpaWorkerService';
import { runRpaScript } from '../../services/rpaWorker/rpaPlaywrightRunner';
import { rpaEnvReady } from '../../services/rpaWorker/rpaEnv';
import { enqueueRpaRetry } from '../../services/rpaWorker/rpaRetryQueue';
import { executeAction } from '../../services/communityAiActionExecutor';
import { chromium } from 'playwright';
import {
  BROWSER_ACTION_ALLOWLIST, BROWSER_ADAPTER_CHANNELS, BROWSER_TARGET_HOST_ALLOWLIST,
  classifyBrowserRequest, createBrowserAdapter,
} from '../../services/orchestration/browserEngineAdapter';
import { buildAdapterRegistry, createWs3Adapter, type EngineStepContext } from '../../services/orchestration/engineAdapters';
import { WORKFLOW_STEP_CHANNELS } from '../../services/workflows/workflowStore';
import {
  CONTRACT_ORG, CONTRACT_OTHER_ORG, contractContext, contractScenarios, expectContractResult,
} from './helpers/engineAdapterContractKit';

const ENGINE_FNS = [executeRpaTask, rpaSchedulerHooks.flushRetries, runRpaScript, rpaEnvReady, enqueueRpaRetry, executeAction, chromium.launch] as unknown as jest.Mock[];
const engineCalls = () => ENGINE_FNS.reduce((n, f) => n + f.mock.calls.length, 0);

/** A step snapshot asking for a browser operation (the field is hypothetical; nothing authors it today). */
const stepAsking = (operation: unknown, target_url: unknown) =>
  ({ key: 's1', channel: 'community', delay_after_previous_hours: 0, execution_mode: 'autonomous', browser: { operation, target_url } }) as unknown as EngineStepContext['step'];

const ctxFor = (overrides: Partial<EngineStepContext> = {}) =>
  contractContext({ channel: 'community', personId: '77777777-7777-4777-8777-777777777777', ...overrides });

beforeEach(() => {
  engine.actions = 0;
  engine.mode = 'ok';
  ENGINE_FNS.forEach((f) => f.mockClear());
});

async function run(ctx: EngineStepContext) {
  const a = createBrowserAdapter();
  const r = await a.execute(ctx);
  expectContractResult(a, r);
  return r;
}

describe('browser adapter — the shared contract', () => {
  it('satisfies contractScenarios', async () => {
    await contractScenarios({
      make: () => createBrowserAdapter(),
      externalActions: () => engine.actions + engineCalls(),
      failAfterCall: () => { engine.mode = 'crash_after_act'; },
      refuseByGate: () => { engine.mode = 'gate_refuses'; },
    }, ctxFor());
    expect(engineCalls()).toBe(0);
    expect(engine.actions).toBe(0);
  });
});

describe('browser adapter — exposes nothing', () => {
  it('has empty action and target allowlists and claims no channel', () => {
    expect(BROWSER_ACTION_ALLOWLIST).toEqual([]);
    expect(BROWSER_TARGET_HOST_ALLOWLIST).toEqual([]);
    expect(BROWSER_ADAPTER_CHANNELS).toEqual([]);
    expect(Object.isFrozen(BROWSER_ACTION_ALLOWLIST)).toBe(true);
    expect(Object.isFrozen(BROWSER_TARGET_HOST_ALLOWLIST)).toBe(true);
    const a = createBrowserAdapter();
    expect(a.engine).toBe('browser');
    expect(a.channels).toEqual([]);
  });

  it('can never be routed to: the registry maps no channel to it, and it steals none', () => {
    const registry = buildAdapterRegistry([createWs3Adapter(), createBrowserAdapter()]);
    for (const c of WORKFLOW_STEP_CHANNELS) expect(registry.get(c)?.engine).not.toBe('browser');
    expect(registry.get('internal')?.engine).toBe('ws3');
  });

  it('imports no browser, RPA, queue, executor or database module', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/orchestration/browserEngineAdapter.ts'), 'utf8');
    const imports = [...src.matchAll(/^import\s.*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    // engineCapabilities is plain data: it imports only the pure execution contract.
    expect(imports).toEqual(['./engineCapabilities', './engineAdapters']);
    expect(fs.readFileSync(path.join(process.cwd(), 'backend/services/orchestration/engineCapabilities.ts'), 'utf8').match(/^import\s.*?from\s+'([^']+)'/gm))
      .toEqual(["import { EXECUTION_CONTRACT_VERSION, type EngineCapabilityDeclaration } from './executionContract';"]);
    expect(/^import type /m.test(src)).toBe(true);
    expect(src).not.toMatch(/require\(|import\(/);
  });

  it('answers a plain step unsupported + needs_human with the missing-capability reason', async () => {
    const r = await run(ctxFor());
    expect(r).toEqual({
      engine: 'browser', outcome: 'unsupported', disposition: 'needs_human',
      reason: 'browser_unsupported:no_journey_safe_browser_operation_exists', externalRef: null,
    });
    expect(engineCalls()).toBe(0);
  });
});

describe('browser adapter — refusals', () => {
  it.each(['reply', 'like', 'share', 'follow', 'schedule', 'dm', 'goto', 'evaluate', 'script', 'discover_users', 'render_pdf'])(
    'unauthorized action "%s" is refused before anything runs', async (op) => {
      const r = await run(ctxFor({ step: stepAsking(op, 'https://www.linkedin.com/feed/update/urn:li:activity:1') }));
      expect(r.disposition).toBe('needs_human');
      expect(r.reason).toBe('browser_unsupported:operation_not_allowlisted');
      expect(engineCalls()).toBe(0);
    });

  it.each([
    'https://evil.example.com/x', 'http://www.linkedin.com/feed', 'javascript:alert(1)',
    'file:///etc/passwd', 'https://user:pw@www.reddit.com/', 'not a url', 42, null,
  ])('unauthorized target %p is refused (operation is checked first, so nothing runs either way)', async (target) => {
    const r = await run(ctxFor({ step: stepAsking('reply', target) }));
    expect(r.disposition).toBe('needs_human');
    expect(r.reason).toMatch(/^browser_unsupported:/);
    expect(engineCalls()).toBe(0);
  });

  it('a non-string or blank operation is "no operation", never coerced', async () => {
    for (const op of [null, '', '   ', 7, { name: 'reply' }]) {
      expect(classifyBrowserRequest(ctxFor({ step: stepAsking(op, 'https://www.reddit.com/') }))).toBe('no_operation_requested');
    }
  });

  it('kill switch: the result does not depend on the engine gates, and no gate is even probed', async () => {
    engine.mode = 'gate_refuses';
    const refused = await run(ctxFor());
    engine.mode = 'ok';
    const open = await run(ctxFor());
    expect(refused).toEqual(open);
    expect(rpaEnvReady as unknown as jest.Mock).not.toHaveBeenCalled();
    expect(executeAction as unknown as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('browser adapter — failure modes of the engine cannot reach the journey', () => {
  it('timeout: a hanging engine cannot hang execute (it is never called)', async () => {
    engine.mode = 'hang';
    const r = await Promise.race([
      run(ctxFor()),
      new Promise<'timed_out'>((res) => setTimeout(() => res('timed_out'), 1000)),
    ]);
    expect(r).not.toBe('timed_out');
    expect(engineCalls()).toBe(0);
  });

  it('crash after acting: nothing acted, nothing is retried', async () => {
    engine.mode = 'crash_after_act';
    for (let i = 0; i < 3; i++) expect((await run(ctxFor())).disposition).toBe('needs_human');
    expect(engine.actions).toBe(0);
    expect(enqueueRpaRetry as unknown as jest.Mock).not.toHaveBeenCalled();
  });

  it('ambiguous completion (post-condition failed after submit) cannot arise and is never retried', async () => {
    engine.mode = 'ambiguous';
    const r = await run(ctxFor({ step: stepAsking('reply', 'https://www.linkedin.com/feed/') }));
    expect(r.outcome).toBe('unsupported');
    expect(r.disposition).toBe('needs_human');
    expect(engine.actions).toBe(0);
  });

  it('duplicate requests for one task (sequential and concurrent) cause zero actions and identical results', async () => {
    const a = createBrowserAdapter();
    const ctx = ctxFor();
    const results = await Promise.all(Array.from({ length: 10 }, () => a.execute(ctx)));
    results.push(await a.execute(ctx), await a.execute(ctx));
    for (const r of results) {
      expectContractResult(a, r);
      expect(r).toEqual(results[0]);
    }
    expect(engineCalls()).toBe(0);
  });
});

describe('browser adapter — tenant context', () => {
  it('a missing or malformed organization is refused as a tenant error', async () => {
    for (const org of ['', '   ', 'not-a-uuid', `${CONTRACT_ORG}x`, undefined as unknown as string]) {
      const r = await run(ctxFor({ organizationId: org }));
      expect(r.reason).toBe('browser_unsupported:tenant_context_invalid');
    }
    expect(engineCalls()).toBe(0);
  });

  it('cross-tenant: two tenants on the same task id get independent results that carry no tenant or person data', async () => {
    const mine = await run(ctxFor({ organizationId: CONTRACT_ORG }));
    const theirs = await run(ctxFor({ organizationId: CONTRACT_OTHER_ORG }));
    expect(mine).toEqual(theirs);
    for (const r of [mine, theirs]) {
      const s = JSON.stringify(r);
      expect(s).not.toContain(CONTRACT_ORG);
      expect(s).not.toContain(CONTRACT_OTHER_ORG);
      expect(s).not.toContain('77777777-7777-4777-8777-777777777777');
      expect(r.externalRef).toBeNull();
    }
    expect(engineCalls()).toBe(0);
  });
});
