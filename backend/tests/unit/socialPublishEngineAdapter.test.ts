/**
 * social_publish engine adapter — the `social_post` step.
 *
 * BEHAVIOUR CHANGE (2026-10-28, intentional): the adapter used to claim `content`
 * and refuse every step. It now claims only the NEW `social_post` channel and,
 * for a step that references a released scheduled post of its own tenant, reports
 * that post's publication state. It still never publishes: every engine write
 * path is a counting tripwire below and must stay at zero.
 *
 * The engine's records (scheduled_posts, social_accounts, campaigns) are an
 * in-memory fake. `engineScheduler` simulates the REAL engine publishing a due
 * post once under its post-level claim (publishNowService.claimScheduledPostForPublish);
 * it is the only thing in this suite that publishes, and the adapter never calls it.
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

// The default deps' only database seam, recorded so the suite can prove it only reads.
const dbCalls: Array<{ table: string; method: string }> = [];
let dbRows: Record<string, Record<string, unknown> | null> = {};
let dbError: Record<string, boolean> = {};
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'insert', 'update', 'upsert', 'delete']) {
      builder[m] = () => { dbCalls.push({ table, method: m }); return builder; };
    }
    builder.maybeSingle = async () => {
      dbCalls.push({ table, method: 'maybeSingle' });
      return dbError[table] ? { data: null, error: { message: 'boom' } } : { data: dbRows[table] ?? null, error: null };
    };
    return builder;
  },
  ownedDbRpc: () => { throw new Error('no rpc expected'); },
}));

import {
  SOCIAL_PUBLISH_CHANNELS,
  SOCIAL_POST_NOT_FOUND_REASON,
  createSocialPublishAdapter,
  defaultSocialPublishDeps,
  type ScheduledPostRow,
  type SocialPublishAdapterDeps,
} from '../../services/orchestration/socialPublishEngineAdapter';
import { buildAdapterRegistry, ENGINE_NAMES } from '../../services/orchestration/engineAdapters';
import type { EngineAdapter, EngineResult, EngineStepContext } from '../../services/orchestration/engineAdapters';
import { WORKFLOW_STEP_CHANNELS } from '../../services/workflows/workflowStore';
import type { WorkflowStep } from '../../services/workflows/workflowStore';
import { PUBLISH_OUTCOME_UNCERTAIN } from '../../queue/publishRetryState';
import { PUBLISH_CALL_STARTED } from '../../queue/publishOutcome';
import {
  CONTRACT_ORG,
  CONTRACT_OTHER_ORG,
  contractContext,
  contractScenarios,
  expectContractResult,
} from './helpers/engineAdapterContractKit';

const POST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_POST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_ACCOUNT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAMPAIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const engineFakes = [
  publishNow, claimScheduledPostForPublish, processPublishJob, processBlockSchedule,
  scheduleCreatorAttachmentPost, scheduleRenderedAutonomousPost, boltQueueAdd,
];
/** Engine write paths the ADAPTER reached. Must always be zero. */
const adapterEngineCalls = (): number => engineFakes.reduce((n, f) => n + f.mock.calls.length, 0);

// ── Fake engine records ─────────────────────────────────────────────────────

interface Store {
  posts: Map<string, ScheduledPostRow>;
  accounts: Map<string, string | null>;
  campaigns: Map<string, { company_id: string | null; status: string | null }>;
  reads: number;
  failReads: boolean;
  /** Publications performed by the simulated engine (never by the adapter). */
  publications: number;
}

function row(over: Partial<ScheduledPostRow>): ScheduledPostRow {
  return {
    id: POST, status: 'scheduled', platform_post_id: null, error_code: null, is_thread_start: false,
    content: 'Approved copy', campaign_id: CAMPAIGN, social_account_id: ACCOUNT, ...over,
  };
}

function newStore(): Store {
  const s: Store = { posts: new Map(), accounts: new Map(), campaigns: new Map(), reads: 0, failReads: false, publications: 0 };
  s.accounts.set(ACCOUNT, CONTRACT_ORG);
  s.accounts.set(OTHER_ACCOUNT, CONTRACT_OTHER_ORG);
  s.campaigns.set(CAMPAIGN, { company_id: CONTRACT_ORG, status: 'active' });
  s.posts.set(POST, row({}));
  return s;
}

function depsOf(s: Store): SocialPublishAdapterDeps {
  const gate = () => { s.reads += 1; if (s.failReads) throw new Error('timeout'); };
  return {
    async readScheduledPost(id) { gate(); return s.posts.get(id) ?? null; },
    async readAccountOrganization(id) { gate(); return s.accounts.get(id) ?? null; },
    async readCampaign(id) { gate(); return s.campaigns.get(id) ?? null; },
  };
}

/** The REAL engine's behaviour, simulated: one post-level CAS claim, one publication. */
function engineScheduler(s: Store, id = POST): void {
  const p = s.posts.get(id);
  if (!p || p.status !== 'scheduled' || p.platform_post_id) return;   // claim refused
  s.posts.set(id, { ...p, status: 'publishing' });                    // claim granted
  s.publications += 1;
  s.posts.set(id, { ...p, status: 'published', platform_post_id: `urn:li:share:${id.slice(0, 4)}` });
}

const step = (over: Record<string, unknown> = {}): WorkflowStep => ({
  key: 'launch-post',
  channel: 'social_post',
  delay_after_previous_hours: 0,
  execution_mode: 'autonomous',
  social_post: { scheduled_post_id: POST },
  ...over,
} as unknown as WorkflowStep);

const ctxFor = (over: Partial<EngineStepContext> = {}): EngineStepContext =>
  contractContext({ channel: 'social_post', step: step(), personId: '77777777-7777-4777-8777-777777777777', ...over });

async function run(a: EngineAdapter, ctx: EngineStepContext): Promise<EngineResult> {
  const r = await a.execute(ctx);
  expectContractResult(a, r);
  return r;
}

let store: Store;
beforeEach(() => {
  for (const f of engineFakes) f.mockReset();
  store = newStore();
  dbCalls.length = 0;
  dbRows = {};
  dbError = {};
});

// ── Identity ────────────────────────────────────────────────────────────────

describe('social_publish adapter — identity and channel separation', () => {
  it('fronts social_publish and claims ONLY social_post (never content)', () => {
    const a = createSocialPublishAdapter(depsOf(store));
    expect(a.engine).toBe('social_publish');
    expect(ENGINE_NAMES).toContain(a.engine);
    expect([...a.channels]).toEqual(['social_post']);
    expect(SOCIAL_PUBLISH_CHANNELS).toEqual(a.channels);
    expect(a.channels).not.toContain('content');
    for (const c of a.channels) expect(WORKFLOW_STEP_CHANNELS as readonly string[]).toContain(c);
  });

  it('content stays unclaimed (prospect resource sharing is not public publishing)', () => {
    const reg = buildAdapterRegistry([
      { engine: 'ws3', channels: ['internal', 'email'], execute: jest.fn() },
      createSocialPublishAdapter(depsOf(store)),
    ]);
    expect(reg.get('social_post')?.engine).toBe('social_publish');
    expect(reg.get('content')).toBeUndefined();
  });

  it('exposes only execute — there is no cancel/publish/schedule operation', () => {
    expect(Object.keys(createSocialPublishAdapter(depsOf(store))).sort()).toEqual(['capabilities', 'channels', 'engine', 'execute']);
  });
});

// ── Reference validation ────────────────────────────────────────────────────

describe('social_publish adapter — reference validation', () => {
  it.each([
    ['no frozen step', { step: null }],
    ['a content step routed here', { channel: 'content', step: step({ channel: 'content', social_post: undefined }) }],
    ['social_post step without a reference', { step: step({ social_post: undefined }) }],
    ['reference is not a uuid', { step: step({ social_post: { scheduled_post_id: 'post-1' } }) }],
    ['reference smuggles copy', { step: step({ social_post: { scheduled_post_id: POST, text: 'Buy now' } }) }],
  ])('%s → reference_missing / needs_human, nothing read or published', async (_l, over) => {
    const r = await run(createSocialPublishAdapter(depsOf(store)), ctxFor(over as Partial<EngineStepContext>));
    expect(r).toMatchObject({ outcome: 'reference_missing', disposition: 'needs_human', externalRef: null });
    expect(store.reads).toBe(0);
    expect(adapterEngineCalls()).toBe(0);
  });

  it('missing post → reference_not_found', async () => {
    const r = await run(createSocialPublishAdapter(depsOf(store)),
      ctxFor({ step: step({ social_post: { scheduled_post_id: OTHER_POST } }) }));
    expect(r).toEqual({ engine: 'social_publish', outcome: 'reference_not_found', disposition: 'needs_human', reason: SOCIAL_POST_NOT_FOUND_REASON, externalRef: null });
  });

  it('cross-tenant post (other tenant\'s account) is indistinguishable from a missing one', async () => {
    store.posts.set(OTHER_POST, row({ id: OTHER_POST, social_account_id: OTHER_ACCOUNT, campaign_id: null }));
    const a = createSocialPublishAdapter(depsOf(store));
    const theirs = await run(a, ctxFor({ step: step({ social_post: { scheduled_post_id: OTHER_POST } }) }));
    store.posts.delete(OTHER_POST);
    const missing = await run(a, ctxFor({ step: step({ social_post: { scheduled_post_id: OTHER_POST } }) }));
    expect(theirs).toEqual(missing);
    // …and the other tenant referencing OUR post gets the same.
    const reverse = await run(a, ctxFor({ organizationId: CONTRACT_OTHER_ORG }));
    expect(reverse).toEqual(missing);
  });

  it('account owner and campaign owner must agree; an unresolved owner is not found', async () => {
    const a = createSocialPublishAdapter(depsOf(store));
    store.campaigns.set(CAMPAIGN, { company_id: CONTRACT_OTHER_ORG, status: 'active' });
    expect((await run(a, ctxFor())).outcome).toBe('reference_not_found');
    store.campaigns.delete(CAMPAIGN);
    expect((await run(a, ctxFor())).outcome).toBe('reference_not_found');
    store.campaigns.set(CAMPAIGN, { company_id: CONTRACT_ORG, status: 'active' });
    store.accounts.set(ACCOUNT, null);
    expect((await run(a, ctxFor())).outcome).toBe('reference_not_found');
  });

  it.each([
    ['draft (never released)', { status: 'draft' }, 'not_released', 'needs_human'],
    ['blocked', { status: 'blocked' }, 'blocked', 'needs_human'],
    ['cancelled', { status: 'cancelled' }, 'cancelled', 'skipped'],
    ['already published', { status: 'published', platform_post_id: 'urn:1' }, 'published', 'completed'],
    ['no content', { content: '   ' }, 'PUBLISH_BLOCKED_POST_NO_CONTENT', 'needs_human'],
    ['thread root', { is_thread_start: true }, 'thread_unsupported', 'needs_human'],
    ['failed attempt', { status: 'failed', error_code: 'RATE_LIMITED' }, 'publish_failed', 'needs_human'],
    ['in flight', { status: 'publishing', error_code: 'PUBLISH_CLAIMED:t1' }, 'publishing', 'wait'],
    ['released, not yet due', {}, 'awaiting_publication', 'wait'],
  ])('%s → %s / %s', async (_l, over, outcome, disposition) => {
    store.posts.set(POST, row(over as Partial<ScheduledPostRow>));
    const r = await run(createSocialPublishAdapter(depsOf(store)), ctxFor());
    expect(r).toMatchObject({ outcome, disposition, externalRef: POST });
    expect(adapterEngineCalls()).toBe(0);
  });

  it('campaign not active → the engine\'s own gate code, needs_human', async () => {
    store.campaigns.set(CAMPAIGN, { company_id: CONTRACT_ORG, status: 'paused' });
    const r = await run(createSocialPublishAdapter(depsOf(store)), ctxFor());
    expect(r).toMatchObject({ outcome: 'PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE', disposition: 'needs_human' });
  });

  it('the instruction is never read as copy (a step text appears in no result)', async () => {
    const secret = 'Post our latest customer story on LinkedIn.';
    const r = await run(createSocialPublishAdapter(depsOf(store)), ctxFor({ step: step({ instruction: secret }) }));
    expect(JSON.stringify(r)).not.toContain(secret);
  });
});

// ── Once per object ─────────────────────────────────────────────────────────

describe('social_publish adapter — N people → at most one publication', () => {
  const people = Array.from({ length: 25 }, (_, i) => ({
    executionTaskId: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
    personId: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`,
  }));

  it('25 people\'s tasks wait on, then complete with, the SAME single publication', async () => {
    const a = createSocialPublishAdapter(depsOf(store));
    const before = await Promise.all(people.map((p) => run(a, ctxFor(p))));
    for (const r of before) expect(r).toEqual(before[0]);
    expect(before[0]).toMatchObject({ outcome: 'awaiting_publication', disposition: 'wait', externalRef: POST });

    engineScheduler(store);
    engineScheduler(store);          // a second scheduler tick: the claim refuses

    const after = await Promise.all(people.map((p) => run(a, ctxFor(p))));
    for (const r of after) expect(r).toEqual({ engine: 'social_publish', outcome: 'published', disposition: 'completed', reason: null, externalRef: POST });
    expect(store.publications).toBe(1);
    expect(adapterEngineCalls()).toBe(0);
  });

  it('without the engine, no number of executions publishes anything', async () => {
    const a = createSocialPublishAdapter(depsOf(store));
    for (const p of people) for (let i = 0; i < 4; i++) await run(a, ctxFor(p));
    expect(store.publications).toBe(0);
    expect(store.posts.get(POST)?.status).toBe('scheduled');
    expect(adapterEngineCalls()).toBe(0);
  });

  it('duplicate and concurrent executes of ONE task are identical and act on nothing', async () => {
    const a = createSocialPublishAdapter(depsOf(store));
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => run(a, ctxFor())));
    for (const r of rs) expect(r).toEqual(rs[0]);
    expect(adapterEngineCalls()).toBe(0);
  });
});

// ── Ambiguity, failures, cancellation ───────────────────────────────────────

describe('social_publish adapter — ambiguous outcomes are never re-published', () => {
  it.each([
    ['engine timed out after the platform call', { status: 'failed', error_code: PUBLISH_OUTCOME_UNCERTAIN }],
    ['engine crashed mid-call, row re-scheduled', { status: 'scheduled', error_code: PUBLISH_CALL_STARTED }],
    ['marked published with no platform id', { status: 'published', platform_post_id: null }],
  ])('%s → uncertain / needs_human, and stays so', async (_l, over) => {
    store.posts.set(POST, row(over as Partial<ScheduledPostRow>));
    const a = createSocialPublishAdapter(depsOf(store));
    const r1 = await run(a, ctxFor());
    const r2 = await run(a, ctxFor());
    expect(r1).toMatchObject({ outcome: 'uncertain', disposition: 'needs_human', externalRef: POST });
    expect(r2).toEqual(r1);
    expect(adapterEngineCalls()).toBe(0);
    expect(store.publications).toBe(0);
  });

  it('a read failure is provably "not acted" → wait, no external ref', async () => {
    store.failReads = true;
    const r = await run(createSocialPublishAdapter(depsOf(store)), ctxFor());
    expect(r).toMatchObject({ outcome: 'read_failed', disposition: 'wait', externalRef: null });
  });

  it('a post cancelled on the campaign side settles every person\'s step skipped; the adapter never cancels', async () => {
    const a = createSocialPublishAdapter(depsOf(store));
    expect((await run(a, ctxFor())).disposition).toBe('wait');
    store.posts.set(POST, row({ status: 'cancelled' }));
    const r = await run(a, ctxFor({ personId: '88888888-8888-4888-8888-888888888888' }));
    expect(r).toMatchObject({ outcome: 'cancelled', disposition: 'skipped' });
    expect(adapterEngineCalls()).toBe(0);
  });
});

// ── Default deps: read-only, tenant flow ────────────────────────────────────

describe('social_publish adapter — default dependencies only read', () => {
  it('reads scheduled_posts, social_accounts and campaigns with select/eq only', async () => {
    dbRows = {
      scheduled_posts: { id: POST, status: 'scheduled', platform_post_id: null, error_code: null, is_thread_start: false, content: 'x', campaign_id: CAMPAIGN, social_account_id: ACCOUNT },
      social_accounts: { company_id: CONTRACT_ORG },
      campaigns: { company_id: CONTRACT_ORG, status: 'active' },
    };
    const r = await run(createSocialPublishAdapter(defaultSocialPublishDeps), ctxFor());
    expect(r).toMatchObject({ outcome: 'awaiting_publication', disposition: 'wait', externalRef: POST });
    expect(new Set(dbCalls.map((c) => c.table))).toEqual(new Set(['scheduled_posts', 'social_accounts', 'campaigns']));
    expect(dbCalls.every((c) => ['select', 'eq', 'maybeSingle'].includes(c.method))).toBe(true);
  });

  it('a database error becomes read_failed → wait', async () => {
    dbError = { scheduled_posts: true };
    const r = await run(createSocialPublishAdapter(defaultSocialPublishDeps), ctxFor());
    expect(r).toMatchObject({ outcome: 'read_failed', disposition: 'wait' });
  });

  it('the adapter source has no write call and imports no engine write path', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/orchestration/socialPublishEngineAdapter.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(code).not.toMatch(/execution_engine_requests|publishNow|publishProcessor|boltQueue|scheduler/i);
    const imports = code.split('\n').filter((l) => /^\s*import\s/.test(l));
    expect(imports.map((l) => (/from '([^']+)'/.exec(l) ?? [])[1]).sort()).toEqual([
      '../../db/writeOwner', './engineAdapters', './engineCapabilities', './socialPostPublicationStatus', './socialPostStepContract',
    ]);
  });
});

// ── Shared contract ─────────────────────────────────────────────────────────

describe('social_publish adapter — shared contract', () => {
  it('satisfies contractScenarios', async () => {
    let current = newStore();
    await contractScenarios(
      {
        make: () => { current = newStore(); return createSocialPublishAdapter(depsOf(current)); },
        externalActions: () => adapterEngineCalls() + current.publications,
        // The adapter never calls the engine. "The engine call timed out after it
        // may have acted" is therefore observed the only way it can be: the
        // engine's own record of the post carries the uncertain marker.
        failAfterCall: () => { current.posts.set(POST, row({ status: 'failed', error_code: PUBLISH_OUTCOME_UNCERTAIN })); },
        // The engine's own gate (campaign not active) refuses the post.
        refuseByGate: () => { current.campaigns.set(CAMPAIGN, { company_id: CONTRACT_ORG, status: 'paused' }); },
      },
      ctxFor(),
    );
    expect(adapterEngineCalls()).toBe(0);
  });
});
