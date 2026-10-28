/**
 * social_post adapter — independent SAFETY review (2026-10-28, of c21771d4).
 *
 * Proves, by static import analysis AND runtime tripwires, that the social_publish
 * journey adapter can never cause a publication:
 *   - no module of the publishing engine's WRITE side is in its runtime import
 *     closure, and none is even LOADED while it runs (load-recording mocks);
 *   - it never writes (scheduled_posts or anything else) and never calls an RPC;
 *   - every verdict that lets a journey proceed is consistent with the engine's
 *     own authorizePostPublish predicate (it is consulted, never bypassed);
 *   - N journeys × M people observing one post never publish anything;
 *   - same-tenant ownership and the full status mapping, incl. gaps the
 *     original suite did not cover (pending, standalone post, orphan post,
 *     unreadable account, case and fence variants).
 * It also asserts no engine adapter claims `content`.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load-recording tripwires for every engine write path ──────────────────────
// A jest.mock factory runs only when the module is REQUIRED. Each records that it
// was loaded and returns functions that throw if ever called.
const loaded: string[] = [];
const called: string[] = [];
const tripwire = (mod: string, names: string[]) => {
  loaded.push(mod);
  const m: Record<string, unknown> = {};
  for (const n of names) m[n] = (..._a: unknown[]) => { called.push(`${mod}.${n}`); throw new Error(`TRIPWIRE ${mod}.${n}`); };
  return m;
};
jest.mock('../../services/publishNowService', () => tripwire('publishNowService', ['publishNow', 'claimScheduledPostForPublish']));
jest.mock('../../queue/jobProcessors/publishProcessor', () => tripwire('publishProcessor', ['processPublishJob']));
jest.mock('../../queue/boltQueue', () => tripwire('boltQueue', ['getBoltQueue', 'enqueueBoltJob']));
jest.mock('../../queue/bullmqClient', () => tripwire('bullmqClient', ['getQueue', 'Queue']));
jest.mock('../../queue/jobQueue', () => tripwire('jobQueue', ['enqueue', 'addJob']));
jest.mock('../../scheduler/schedulerService', () => tripwire('schedulerService', ['runSchedulerCycle', 'findDuePostsAndEnqueue']));
jest.mock('../../scheduler/schedulerPostQueueControl', () => tripwire('schedulerPostQueueControl', ['enqueuePost']));
jest.mock('../../services/boltScheduleBlockProcessor', () => tripwire('boltScheduleBlockProcessor', ['processBlockSchedule']));
jest.mock('../../services/creator/creatorRowScheduler', () => tripwire('creatorRowScheduler', ['scheduleCreatorAttachmentPost', 'scheduleRenderedAutonomousPost']));
jest.mock('../../../lib/campaign/campaignRelease', () => tripwire('campaignRelease', ['releaseCampaign']));
jest.mock('bullmq', () => tripwire('bullmq', ['Queue', 'Worker', 'FlowProducer']), { virtual: true });

// The engine's authorization predicate: the REAL implementation, observed.
const authorizeSpy = jest.fn();
jest.mock('../../../lib/campaign/publishAuthorization', () => {
  const actual = jest.requireActual('../../../lib/campaign/publishAuthorization');
  return { ...actual, authorizePostPublish: (f: unknown) => { authorizeSpy(f); return actual.authorizePostPublish(f); } };
});

// The only database seam. Reads are served from `dbRows`; ANY write or RPC trips.
const dbCalls: Array<{ table: string; method: string; args: unknown[] }> = [];
let dbRows: Record<string, Record<string, unknown> | null> = {};
const WRITE_METHODS = ['insert', 'update', 'upsert', 'delete'];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'limit', 'order', ...WRITE_METHODS]) {
      b[m] = (...args: unknown[]) => {
        dbCalls.push({ table, method: m, args });
        if (WRITE_METHODS.includes(m)) throw new Error(`TRIPWIRE write ${table}.${m}`);
        return b;
      };
    }
    b.maybeSingle = async () => { dbCalls.push({ table, method: 'maybeSingle', args: [] }); return { data: dbRows[table] ?? null, error: null }; };
    b.single = b.maybeSingle;
    return b;
  },
  ownedDbRpc: (name: string) => { called.push(`rpc:${name}`); throw new Error(`TRIPWIRE rpc ${name}`); },
}));

import { authorizePostPublish } from '../../../lib/campaign/publishAuthorization';
import {
  createSocialPublishAdapter,
  defaultSocialPublishDeps,
  SOCIAL_POST_NOT_FOUND_REASON,
  type ScheduledPostRow,
  type SocialPublishAdapterDeps,
} from '../../services/orchestration/socialPublishEngineAdapter';
import { BROWSER_ADAPTER_CHANNELS } from '../../services/orchestration/browserEngineAdapter';
import type { EngineResult, EngineStepContext } from '../../services/orchestration/engineAdapters';
import { PUBLISH_OUTCOME_UNCERTAIN } from '../../queue/publishRetryState';
import {
  PUBLISH_CALL_STARTED, PUBLISH_RECONCILED_NOT_PUBLISHED, publishClaimCode, threadReschedulingCode,
} from '../../queue/publishOutcome';
import { CONTRACT_ORG, CONTRACT_OTHER_ORG, contractContext } from './helpers/engineAdapterContractKit';

const ROOT = process.cwd();
const POST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAMPAIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const postRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: POST, status: 'scheduled', platform_post_id: null, error_code: null, is_thread_start: false,
  content: 'Approved copy', campaign_id: CAMPAIGN, social_account_id: ACCOUNT, ...over,
});

const ctxFor = (over: Partial<EngineStepContext> = {}): EngineStepContext => contractContext({
  channel: 'social_post',
  step: { key: 'launch', channel: 'social_post', delay_after_previous_hours: 0, execution_mode: 'autonomous', social_post: { scheduled_post_id: POST } } as unknown as EngineStepContext['step'],
  personId: '77777777-7777-4777-8777-777777777777',
  ...over,
});

const ENGINE_TOUCH = (): { loaded: string[]; called: string[]; writes: number } => ({
  loaded: [...loaded],
  called: [...called],
  writes: dbCalls.filter((c) => WRITE_METHODS.includes(c.method)).length,
});
const UNTOUCHED = { loaded: [], called: [], writes: 0 };

beforeEach(() => {
  dbCalls.length = 0;
  called.length = 0;
  authorizeSpy.mockClear();
  dbRows = {
    scheduled_posts: postRow(),
    social_accounts: { company_id: CONTRACT_ORG },
    campaigns: { company_id: CONTRACT_ORG, status: 'active' },
  };
});

// ── 1. Static: the runtime import closure ─────────────────────────────────────

/** Runtime (non-type-only) relative import closure of a source file, repo-relative. */
function runtimeClosure(entry: string): { files: string[]; external: string[] } {
  const seen = new Set<string>();
  const external = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    const base = path.resolve(path.dirname(from), spec);
    for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
  };
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/^\s*(?:import|export)\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?/gm, '');
    const specs = [
      ...[...code.matchAll(/^\s*(?:import|export)\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
      ...[...code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
      ...[...code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
      ...[...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ];
    for (const s of specs) {
      if (s.startsWith('.')) {
        const r = resolve(file, s);
        if (r) walk(r); else external.add(`UNRESOLVED:${s}`);
      } else if (s.startsWith('@/')) {
        const r = resolve(path.join(ROOT, 'x'), `./${s.slice(2)}`);
        if (r) walk(r); else external.add(`UNRESOLVED:${s}`);
      } else external.add(s);
    }
  };
  walk(path.join(ROOT, entry));
  return { files: [...seen].map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort(), external: [...external].sort() };
}

/** Everything on the publishing engine's WRITE side. */
const ENGINE_WRITE_SIDE = [
  /^backend\/services\/publishNowService\.ts$/,
  /^backend\/queue\/(?!publishOutcome\.ts$|publishRetryState\.ts$)/,   // every queue module but the two pure evidence readers
  /^backend\/scheduler\//,
  /^backend\/services\/boltScheduleBlockProcessor\.ts$/,
  /^backend\/services\/creator\//,
  /^lib\/campaign\/(?!publishAuthorization\.ts$)/,                     // every campaign module but the pure predicate
  /^backend\/services\/socialPlatformPublisher/,
  /^backend\/adapters\//,
];

describe('static — the adapter cannot reach the engine write side', () => {
  const ENTRIES = [
    'backend/services/orchestration/socialPublishEngineAdapter.ts',
    'backend/services/orchestration/socialPostPublicationStatus.ts',
    'backend/services/orchestration/socialPostStepContract.ts',
  ];

  it.each(ENTRIES)('%s: no engine write-side module and no queue library in its runtime closure', (entry) => {
    const { files, external } = runtimeClosure(entry);
    expect(files).toContain(entry);
    const offending = files.filter((f) => ENGINE_WRITE_SIDE.some((re) => re.test(f)));
    expect(offending).toEqual([]);
    expect(external.filter((e) => /^(bullmq|bull|bee-queue|node-cron|cron)$/.test(e) || e.startsWith('UNRESOLVED:./') || e.startsWith('UNRESOLVED:../'))).toEqual([]);
  });

  it('the step contract is import-free and the status module imports only pure engine readers', () => {
    expect(runtimeClosure(ENTRIES[2]).files).toEqual([ENTRIES[2]]);
    const status = runtimeClosure(ENTRIES[1]).files;
    expect(status).toEqual(expect.arrayContaining([
      'lib/campaign/publishAuthorization.ts', 'backend/queue/publishOutcome.ts', 'backend/queue/publishRetryState.ts',
    ]));
  });

  it('the evidence readers it imports are themselves write-free for scheduled_posts state transitions', () => {
    // publishOutcome / publishAuthorization are pure; publishRetryState is imported
    // only for a constant. Assert the adapter path uses nothing else from them.
    const src = fs.readFileSync(path.join(ROOT, ENTRIES[1]), 'utf8');
    const imports = [...src.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+'([^']+)'/gm)]
      .map((m) => ({ from: m[2], names: m[1].split(',').map((n) => n.trim()).filter(Boolean).sort() }));
    expect(imports).toEqual([
      { from: '../../../lib/campaign/publishAuthorization', names: ['authorizePostPublish'] },
      { from: '../../queue/publishOutcome', names: ['publishOutcomeBlocksAttempt'] },
    ]);
    expect(fs.readFileSync(path.join(ROOT, 'lib/campaign/publishAuthorization.ts'), 'utf8')).not.toMatch(/^import\s(?!type)/m);
  });

  it('no source in the closure names publishNow, processPublishJob, claimScheduledPostForPublish or a queue add', () => {
    for (const f of runtimeClosure(ENTRIES[0]).files.filter((x) => x.startsWith('backend/services/orchestration/'))) {
      const code = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect({ f, hit: /\b(publishNow|processPublishJob|claimScheduledPostForPublish|getBoltQueue|enqueue\w*)\s*\(|\.add\(/.exec(code)?.[0] ?? null })
        .toEqual({ f, hit: null });
    }
  });
});

// ── 2. Runtime tripwires across every state ───────────────────────────────────

const STATES: Array<[string, Record<string, unknown>]> = [
  ['pending', { status: 'pending' }],
  ['draft', { status: 'draft' }],
  ['scheduled', {}],
  ['SCHEDULED (case)', { status: ' SCHEDULED ' }],
  ['publishing (claimed)', { status: 'publishing', error_code: publishClaimCode('t1') }],
  ['publishing (call started)', { status: 'publishing', error_code: PUBLISH_CALL_STARTED }],
  ['PUBLISHING (case)', { status: 'PUBLISHING' }],
  ['published', { status: 'published', platform_post_id: 'urn:li:share:1' }],
  ['published, no platform id', { status: 'published' }],
  ['failed', { status: 'failed', error_code: 'RATE_LIMITED' }],
  ['failed, no code', { status: 'failed' }],
  ['failed, reconciled not published', { status: 'failed', error_code: PUBLISH_RECONCILED_NOT_PUBLISHED }],
  ['failed, uncertain', { status: 'failed', error_code: PUBLISH_OUTCOME_UNCERTAIN }],
  ['scheduled, call started (crash)', { error_code: PUBLISH_CALL_STARTED }],
  ['scheduled, thread re-schedule fence', { error_code: threadReschedulingCode('t2') }],
  ['cancelled', { status: 'cancelled' }],
  ['blocked', { status: 'blocked' }],
  ['unknown', { status: 'weird' }],
  ['null status', { status: null }],
  ['thread root', { is_thread_start: true }],
  ['no content', { content: '' }],
];

const EXPECTED: Record<string, [string, EngineResult['disposition']]> = {
  pending: ['not_released', 'needs_human'],
  draft: ['not_released', 'needs_human'],
  scheduled: ['awaiting_publication', 'wait'],
  'SCHEDULED (case)': ['awaiting_publication', 'wait'],
  'publishing (claimed)': ['publishing', 'wait'],
  'publishing (call started)': ['publishing', 'wait'],
  'PUBLISHING (case)': ['publishing', 'wait'],
  published: ['published', 'completed'],
  'published, no platform id': ['uncertain', 'needs_human'],
  failed: ['publish_failed', 'needs_human'],
  'failed, no code': ['publish_failed', 'needs_human'],
  'failed, reconciled not published': ['publish_failed', 'needs_human'],
  'failed, uncertain': ['uncertain', 'needs_human'],
  'scheduled, call started (crash)': ['uncertain', 'needs_human'],
  'scheduled, thread re-schedule fence': ['publishing', 'wait'],
  cancelled: ['cancelled', 'skipped'],
  blocked: ['blocked', 'needs_human'],
  unknown: ['not_released', 'needs_human'],
  'null status': ['not_released', 'needs_human'],
  'thread root': ['thread_unsupported', 'needs_human'],
  'no content': ['PUBLISH_BLOCKED_POST_NO_CONTENT', 'needs_human'],
};

describe('runtime — every state, many tasks, default (real) deps: nothing loaded, called or written', () => {
  it.each(STATES)('%s → expected mapping; engine untouched', async (label, over) => {
    dbRows.scheduled_posts = postRow(over);
    const a = createSocialPublishAdapter(defaultSocialPublishDeps);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => a.execute(ctxFor({
      executionTaskId: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
      executionInstanceId: `33333333-3333-4333-8333-${String(i % 3).padStart(12, '0')}`,
    }))));
    for (const r of rs) expect(r).toEqual(rs[0]);
    expect([rs[0].outcome, rs[0].disposition]).toEqual(EXPECTED[label]);
    expect(rs[0].disposition).not.toBe('failed');
    expect(ENGINE_TOUCH()).toEqual(UNTOUCHED);
    expect(dbCalls.every((c) => ['select', 'eq', 'maybeSingle'].includes(c.method))).toBe(true);
    expect(new Set(dbCalls.map((c) => c.table))).toEqual(new Set(['scheduled_posts', 'social_accounts', 'campaigns']));
  });

  it('every state in the table is covered', () => {
    expect(STATES.map(([l]) => l).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

// ── 3. The engine's authorization predicate is consulted, never bypassed ─────

describe('authorizePostPublish — a proceeding verdict is always one the engine itself authorizes', () => {
  const statuses = ['pending', 'draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled', 'blocked', null];
  const codes = [null, 'RATE_LIMITED', PUBLISH_OUTCOME_UNCERTAIN, PUBLISH_CALL_STARTED, publishClaimCode('x')];
  const campaigns: Array<[string | null, string | null]> = [[CAMPAIGN, 'active'], [CAMPAIGN, 'paused'], [null, null]];
  const grid: Array<Record<string, unknown>> = [];
  for (const status of statuses) for (const error_code of codes) for (const [campaign_id, cs] of campaigns)
    for (const platform_post_id of [null, 'urn:1']) for (const content of ['copy', ''])
      grid.push({ status, error_code, campaign_id, campaign_status: cs, platform_post_id, content });

  it(`over ${grid.length} combinations: awaiting_publication ⇒ engine-authorized; completed ⇒ platform id; never failed; engine untouched`, async () => {
    const a = createSocialPublishAdapter(defaultSocialPublishDeps);
    let awaiting = 0;
    for (const g of grid) {
      dbRows.scheduled_posts = postRow({ status: g.status, error_code: g.error_code, campaign_id: g.campaign_id, platform_post_id: g.platform_post_id, content: g.content });
      dbRows.campaigns = g.campaign_id ? { company_id: CONTRACT_ORG, status: g.campaign_status } : null;
      authorizeSpy.mockClear();
      const r = await a.execute(ctxFor());
      expect(r.disposition).not.toBe('failed');
      if (r.outcome === 'awaiting_publication') {
        awaiting += 1;
        expect(authorizeSpy).toHaveBeenCalledTimes(1);
        expect(authorizePostPublish({
          campaign_id: g.campaign_id as string | null,
          campaign_status: g.campaign_id ? (g.campaign_status as string) : undefined,
          post_status: g.status as string | null,
          platform_post_id: g.platform_post_id as string | null,
          is_thread_start: false,
          has_content: g.content !== '',
        }).authorized).toBe(true);
        expect(String(g.status)).toBe('scheduled');
      }
      if (r.disposition === 'completed') expect(g.platform_post_id).toBe('urn:1');
      if (r.disposition === 'wait') expect(['awaiting_publication', 'publishing']).toContain(r.outcome);
    }
    expect(awaiting).toBeGreaterThan(0);
    expect(ENGINE_TOUCH()).toEqual(UNTOUCHED);
  });
});

// ── 4. N journeys observing one post → at most one publication ───────────────

describe('N journey instances observing ONE post', () => {
  it('3 journeys × 20 people, with the engine publishing mid-way: ≤ 1 publication, all by the engine', async () => {
    // Simulated engine: the REAL engine's post-level CAS (status scheduled → publishing), once.
    let publications = 0;
    const post: Record<string, unknown> = postRow();
    const engineTick = (): void => {
      if (post.status !== 'scheduled' || post.platform_post_id) return;
      post.status = 'publishing';
      publications += 1;
      post.status = 'published';
      post.platform_post_id = 'urn:li:share:9';
    };
    const deps: SocialPublishAdapterDeps = {
      async readScheduledPost() { return { ...post } as unknown as ScheduledPostRow; },
      async readAccountOrganization() { return CONTRACT_ORG; },
      async readCampaign() { return { company_id: CONTRACT_ORG, status: 'active' }; },
    };
    const a = createSocialPublishAdapter(deps);
    const tasks = Array.from({ length: 60 }, (_, i) => ctxFor({
      executionInstanceId: `33333333-3333-4333-8333-${String(i % 3).padStart(12, '0')}`,
      executionTaskId: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
      personId: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`,
    }));
    const results: EngineResult[] = [];
    for (let round = 0; round < 3; round++) {
      results.push(...await Promise.all(tasks.map((t) => a.execute(t))));
      engineTick();
      engineTick();
    }
    expect(publications).toBe(1);
    expect(new Set(results.map((r) => r.externalRef))).toEqual(new Set([POST]));
    expect(new Set(results.map((r) => r.outcome))).toEqual(new Set(['awaiting_publication', 'published']));
    expect(ENGINE_TOUCH()).toEqual(UNTOUCHED);
  });

  it('the engine\'s post-level claim is a compare-and-set on scheduled_posts.status (source, unmodified by this work)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/publishNowService.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function claimScheduledPostForPublish('));
    expect(fn.length).toBeGreaterThan(0);
    expect(fn.slice(0, 1500)).toMatch(/\.update\(\{ status: 'publishing'[\s\S]*query = query\.eq\('status', status\)/);
  });
});

// ── 5. Tenant ownership gaps ──────────────────────────────────────────────────

describe('same-tenant ownership', () => {
  const notFound = { engine: 'social_publish', outcome: 'reference_not_found', disposition: 'needs_human', reason: SOCIAL_POST_NOT_FOUND_REASON, externalRef: null };

  it('a post with NO social account is not found (no owner → no tenant), and its campaign alone is not enough', async () => {
    dbRows.scheduled_posts = postRow({ social_account_id: null });
    expect(await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor())).toEqual(notFound);
    expect(dbCalls.some((c) => c.table === 'social_accounts')).toBe(false);
  });

  it('a standalone post (no campaign) of this tenant is observable; campaigns is not read', async () => {
    dbRows.scheduled_posts = postRow({ campaign_id: null });
    const r = await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor());
    expect(r).toMatchObject({ outcome: 'awaiting_publication', disposition: 'wait', externalRef: POST });
    expect(dbCalls.some((c) => c.table === 'campaigns')).toBe(false);
  });

  it.each([
    ['account owned by another tenant', { social_accounts: { company_id: CONTRACT_OTHER_ORG } }],
    ['account with no company', { social_accounts: { company_id: null } }],
    ['account missing', { social_accounts: null }],
    ['campaign owned by another tenant', { campaigns: { company_id: CONTRACT_OTHER_ORG, status: 'active' } }],
    ['campaign with no company', { campaigns: { company_id: null, status: 'active' } }],
    ['campaign missing', { campaigns: null }],
    ['blank company id', { social_accounts: { company_id: '  ' } }],
  ])('%s → not found (indistinguishable from missing)', async (_l, over) => {
    Object.assign(dbRows, over);
    expect(await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor())).toEqual(notFound);
  });

  it('a published post of another tenant is not found — its state is never disclosed', async () => {
    dbRows.scheduled_posts = postRow({ status: 'published', platform_post_id: 'urn:1' });
    const r = await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor({ organizationId: CONTRACT_OTHER_ORG }));
    expect(r).toEqual(notFound);
  });

  it('tenant ids compare case-insensitively (uuid text), and only exactly', async () => {
    dbRows.social_accounts = { company_id: CONTRACT_ORG.toUpperCase() };
    dbRows.campaigns = { company_id: CONTRACT_ORG.toUpperCase(), status: 'ACTIVE' };
    expect((await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor())).outcome).toBe('awaiting_publication');
    dbRows.social_accounts = { company_id: `${CONTRACT_ORG} ` };
    expect((await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor())).outcome).toBe('reference_not_found');
  });

  it('an unreadable account or campaign is read_failed → wait, nothing acted', async () => {
    const throwing = (which: 'acct' | 'camp'): SocialPublishAdapterDeps => ({
      async readScheduledPost() { return postRow() as unknown as ScheduledPostRow; },
      async readAccountOrganization() { if (which === 'acct') throw new Error('x'); return CONTRACT_ORG; },
      async readCampaign() { if (which === 'camp') throw new Error('x'); return { company_id: CONTRACT_ORG, status: 'active' }; },
    });
    for (const w of ['acct', 'camp'] as const) {
      expect(await createSocialPublishAdapter(throwing(w)).execute(ctxFor()))
        .toMatchObject({ outcome: 'read_failed', disposition: 'wait', externalRef: null });
    }
    expect(ENGINE_TOUCH()).toEqual(UNTOUCHED);
  });

  it('the referenced id is the step\'s, never anything from the context (person/subject cannot redirect it)', async () => {
    await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor({ subject: { kind: 'prospect', id: CAMPAIGN } as EngineStepContext['subject'] }));
    const postReads = dbCalls.filter((c) => c.table === 'scheduled_posts' && c.method === 'eq');
    expect(postReads).toEqual([{ table: 'scheduled_posts', method: 'eq', args: ['id', POST] }]);
  });
});

// ── 6. `content` stays unclaimed ──────────────────────────────────────────────

describe('content — no engine adapter claims it', () => {
  it('no channels declaration in backend/services/orchestration includes content', () => {
    const dir = path.join(ROOT, 'backend/services/orchestration');
    const hits: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const m of code.matchAll(/(?:\bchannels\s*:|_CHANNELS\b[^=\n]*=)\s*(?:Object\.freeze\(\s*)?\[([^\]]*)\]/g)) {
        if (/['"]content['"]/.test(m[1])) hits.push(`${f}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the social and browser adapters\' channel lists exclude content at runtime', () => {
    expect(createSocialPublishAdapter(defaultSocialPublishDeps).channels).toEqual(['social_post']);
    expect(BROWSER_ADAPTER_CHANNELS).not.toContain('content');
  });

  it('a content step routed to the social adapter is refused without reading anything', async () => {
    const r = await createSocialPublishAdapter(defaultSocialPublishDeps).execute(ctxFor({
      channel: 'content',
      step: { key: 'share', channel: 'content', delay_after_previous_hours: 0, execution_mode: 'assisted' } as unknown as EngineStepContext['step'],
    }));
    expect(r).toMatchObject({ outcome: 'reference_missing', disposition: 'needs_human', externalRef: null });
    expect(dbCalls).toEqual([]);
  });
});

afterAll(() => {
  // Final tripwire: across the whole suite no engine module was ever loaded.
  expect(loaded).toEqual([]);
});
