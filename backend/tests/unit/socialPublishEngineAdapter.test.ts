/**
 * social_publish engine adapter. The engine has no entry point a workflow step
 * can reach without inventing a post (see the module header), so the adapter
 * must report `unsupported` → `needs_human` and never touch the engine.
 *
 * The engine's write paths are replaced with counting fakes: any call is an
 * "external action". None may ever happen.
 */

import * as fs from 'fs';
import * as path from 'path';

const publishNow = jest.fn();
const claimScheduledPostForPublish = jest.fn();
const processPublishJob = jest.fn();
const processBlockSchedule = jest.fn();
const scheduleCreatorAttachmentPost = jest.fn();
const scheduleRenderedAutonomousPost = jest.fn();
const boltQueueAdd = jest.fn();

jest.mock('../../services/publishNowService', () => ({ publishNow, claimScheduledPostForPublish }));
jest.mock('../../queue/jobProcessors/publishProcessor', () => ({ processPublishJob }));
jest.mock('../../services/boltScheduleBlockProcessor', () => ({ processBlockSchedule }));
jest.mock('../../services/creator/creatorRowScheduler', () => ({
  scheduleCreatorAttachmentPost, scheduleRenderedAutonomousPost,
}));
jest.mock('../../queue/boltQueue', () => ({ getBoltQueue: () => ({ add: boltQueueAdd }) }));

import {
  SOCIAL_PUBLISH_CHANNELS,
  SOCIAL_PUBLISH_MISSING_INTERFACE,
  SOCIAL_PUBLISH_UNSUPPORTED_OUTCOME,
  createSocialPublishAdapter,
} from '../../services/orchestration/socialPublishEngineAdapter';
import { buildAdapterRegistry, ENGINE_NAMES } from '../../services/orchestration/engineAdapters';
import type { EngineAdapter, EngineStepContext } from '../../services/orchestration/engineAdapters';
import { WORKFLOW_STEP_CHANNELS } from '../../services/workflows/workflowStore';
import type { WorkflowStep } from '../../services/workflows/workflowStore';
import {
  CONTRACT_OTHER_ORG,
  contractContext,
  contractScenarios,
  expectContractResult,
} from './helpers/engineAdapterContractKit';

const engineFakes = [
  publishNow, claimScheduledPostForPublish, processPublishJob, processBlockSchedule,
  scheduleCreatorAttachmentPost, scheduleRenderedAutonomousPost, boltQueueAdd,
];
const externalActions = (): number => engineFakes.reduce((n, f) => n + f.mock.calls.length, 0);

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  key: 'share-case-study',
  channel: 'content',
  delay_after_previous_hours: 0,
  execution_mode: 'autonomous',
  instruction: 'Post our latest customer story on LinkedIn.',
  ...overrides,
});

/** The fake engine has no failure mode the adapter can reach: these arm nothing. */
let armedAfterCall = false;
let armedGate = false;

beforeEach(() => {
  for (const f of engineFakes) f.mockReset();
  armedAfterCall = false;
  armedGate = false;
});

function run(a: EngineAdapter, ctx: EngineStepContext) {
  return a.execute(ctx).then((r) => {
    expectContractResult(a, r);
    return r;
  });
}

describe('social_publish adapter — identity', () => {
  it('fronts the social_publish engine and claims only content', () => {
    const a = createSocialPublishAdapter();
    expect(a.engine).toBe('social_publish');
    expect(ENGINE_NAMES).toContain(a.engine);
    expect([...a.channels]).toEqual(['content']);
    for (const c of a.channels) expect(WORKFLOW_STEP_CHANNELS as readonly string[]).toContain(c);
    expect(SOCIAL_PUBLISH_CHANNELS).toEqual(a.channels);
  });

  it('coexists in the registry without claiming another engine\'s channel', () => {
    const others: EngineAdapter[] = [
      { engine: 'ws3', channels: ['internal', 'email'], execute: jest.fn() },
      { engine: 'whatsapp', channels: ['whatsapp'], execute: jest.fn() },
    ];
    const reg = buildAdapterRegistry([...others, createSocialPublishAdapter()]);
    expect(reg.get('content')?.engine).toBe('social_publish');
    expect(reg.get('whatsapp')?.engine).toBe('whatsapp');
    expect(reg.get('community')).toBeUndefined();
  });
});

describe('social_publish adapter — unsupported, never invented', () => {
  it.each([
    ['no frozen step', null],
    ['autonomous step with an instruction', step()],
    ['human-mode step', step({ execution_mode: 'human' })],
    ['step requiring approval', step({ requires_approval: true })],
    ['step without an instruction', step({ instruction: undefined })],
  ])('%s → unsupported / needs_human, nothing published', async (_label, s) => {
    const a = createSocialPublishAdapter();
    const r = await run(a, contractContext({ step: s, personId: '77777777-7777-4777-8777-777777777777' }));
    expect(r).toEqual({
      engine: 'social_publish',
      outcome: SOCIAL_PUBLISH_UNSUPPORTED_OUTCOME,
      disposition: 'needs_human',
      reason: SOCIAL_PUBLISH_MISSING_INTERFACE,
      externalRef: null,
    });
    expect(externalActions()).toBe(0);
  });

  it('never treats the instruction as post content (the reason carries no step text)', async () => {
    const secret = 'Post our latest customer story on LinkedIn.';
    const r = await run(createSocialPublishAdapter(), contractContext({ step: step({ instruction: secret }) }));
    expect(r.reason).not.toContain(secret);
    expect(r.reason).toMatch(/scheduled_posts/);
    expect(r.disposition).not.toBe('completed');
  });

  it('cross-tenant: another tenant\'s task gets the same refusal and no engine call', async () => {
    const a = createSocialPublishAdapter();
    const mine = await run(a, contractContext({ step: step() }));
    const theirs = await run(a, contractContext({ organizationId: CONTRACT_OTHER_ORG, step: step() }));
    expect(theirs).toEqual(mine);
    expect(theirs.externalRef).toBeNull();
    expect(externalActions()).toBe(0);
  });

  it('duplicate execute (re-sweep, concurrent sweeps) never acts and is stable', async () => {
    const a = createSocialPublishAdapter();
    const ctx = contractContext({ step: step() });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => run(a, ctx)));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(externalActions()).toBe(0);
  });

  it('never chooses failed and never chooses wait (a retry cannot make it supportable)', async () => {
    const r = await run(createSocialPublishAdapter(), contractContext({ step: step() }));
    expect(r.disposition).toBe('needs_human');
  });

  it('does not import any engine write path (the source has no publish/schedule import)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/orchestration/socialPublishEngineAdapter.ts'), 'utf8',
    );
    const imports = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/from '\.\/engineAdapters'/);
    expect(imports[0]).toMatch(/^import type /);
  });
});

describe('social_publish adapter — shared contract', () => {
  it('satisfies contractScenarios', async () => {
    await contractScenarios(
      {
        make: () => createSocialPublishAdapter(),
        externalActions,
        // The adapter never reaches the engine, so an after-call failure or a
        // gate refusal can never be observed; arming them must change nothing.
        failAfterCall: () => { armedAfterCall = true; },
        refuseByGate: () => { armedGate = true; },
      },
      contractContext({ step: step() }),
    );
    expect(armedAfterCall).toBe(true);
    expect(armedGate).toBe(true);
    expect(externalActions()).toBe(0);
  });
});
