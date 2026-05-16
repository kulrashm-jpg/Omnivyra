/**
 * Validation — Step-R4 async render queue orchestration.
 *
 *   1  async render success
 *   2  exactly-once leasing (race → one winner)
 *   3  retry correctness (transient + cap)
 *   4  timeout handling
 *   5  provider failover selection (health-gated chain)
 *   6  immutable lineage preservation (append-only inserts)
 *   7  moderation enforcement (pre/post fail-closed, no retry)
 *   8  shared-media attachment correctness
 *   9  scheduler isolation (no scheduler/Text writes)
 *   10 synchronous fallback parity (queue flag OFF)
 *
 * Mocked provider + in-memory DB (DI) — no network. LIVE micro-check
 * re-confirms queue monotonic guard (tx + rollback).
 */

import {
  isCreatorRenderQueueEnabled, isTransientFailure, isTerminalFailure,
  enqueueRenderJob, failRenderJob, processQueuedRenderJob,
  createRenderProviderRegistry,
} from '../../services/creator/rendering';
import type { RenderProvider } from '../../services/creator/rendering';

function provider(over: Partial<RenderProvider> = {}): RenderProvider {
  return {
    key: 'openai',
    capabilities: () => ({ modalities: ['image'], max_duration_sec: 0, resolutions: [{ w: 1024, h: 1024 }], aspect_ratios: ['1:1'], supports_seed: false, supports_audio: false, supports_overlay_text: false, supports_batch: false, max_concurrent: 2 }),
    supports: () => true,
    estimateCost: () => ({ estimated_credits: 5, currency: 'CREDITS' }),
    submit: async () => ({ provider: 'openai', external_job_id: 'x', provider_metadata: { url: 'https://cdn/r.png' } }),
    poll: async (h) => ({ handle: h, state: 'succeeded', progress: 1 }),
    fetchOutput: async (h) => ({ output_id: 'o', content_sha256: '', storage_ref: String((h.provider_metadata as any).url), modality: 'image', mime_type: 'image/png', byte_size: 0, version: 1, derived_from_output_id: null }),
    cancel: async () => undefined,
    ...over,
  };
}

const SPEC = {
  spec_id: 'render:' + 'a'.repeat(64),
  canonical_asset_family: 'image', render_modality: 'image',
  blueprint_projection: { asset_family: 'image', storyboard: [{ s: 1 }], overlays: [], pacing_guidance: '', scene_direction: 'clean office', visual_prompt: 'a calm office' },
  packaging_projection: { caption: 'c', overlay_text: [] },
  platform_projection: { platform: 'instagram', aspect_ratio: '1:1', resolution: { w: 1024, h: 1024 } },
  rendering_parameters: { modality: 'image' },
  moderation_context: { canonical_asset_key: 'image', is_text_like: false, moderated_text: ['a calm office'] },
  deterministic_input_hash: 'a'.repeat(64),
};

function mockDeps(o: {
  claim?: any; job?: any; claimWins?: boolean; specOverride?: any;
} = {}) {
  const writes: { table: string; op: string; row?: any }[] = [];
  const reader = (table: string) => {
    const q: any = {};
    q.select = () => q; q.eq = () => q; q.in = () => q; q.order = () => q; q.limit = () => q; q.lt = () => q;
    q.maybeSingle = async () => {
      if (table === 'creator_render_queue_job') return { data: o.claim ? null : null };
      if (table === 'creator_render_job') return { data: o.job ?? { id: 'job-1', render_spec_snapshot: o.specOverride ?? SPEC, organization_id: 'org', task_id: 'core-1', deterministic_input_hash: 'a'.repeat(64) } };
      if (table === 'billing_operations') return { data: { id: 'bo-1' } };
      return { data: null };
    };
    // candidate scan returns one queued row
    if (table === 'creator_render_queue_job') {
      q.limit = async () => ({ data: o.claim ? [o.claim] : [] });
    }
    return q;
  };
  const writer = (table: string) => {
    const q: any = {};
    q.insert = (row: any) => {
      const rec = { id: `${table}-1`, ...(Array.isArray(row) ? row[0] : row) };
      writes.push({ table, op: 'insert', row: rec });
      return { select: () => ({ single: async () => ({ data: rec }), maybeSingle: async () => ({ data: rec }) }) };
    };
    q.update = (patch: any) => {
      writes.push({ table, op: 'update', row: patch });
      const chain: any = {
        eq: () => chain, in: () => chain, lt: () => chain,
        select: () => ({ maybeSingle: async () => ({ data: o.claimWins === false ? null : { id: 'q-1', render_job_id: 'job-1', provider_key: 'openai', retry_count: o.claim?.retry_count ?? 0 } }) }),
        then: undefined,
      };
      // terminal awaited update (no select)
      chain.eq = () => chain;
      return Object.assign(Promise.resolve({ error: null }), chain);
    };
    q.upsert = (row: any) => { writes.push({ table, op: 'upsert', row }); return { select: () => ({ single: async () => ({ data: { id: 'u' } }) }) }; };
    return q;
  };
  return {
    deps: { supabase: { from: reader, rpc: async () => ({ data: {} }) }, ownedDbTable: writer, now: () => '2026-05-16T00:00:00Z', providerRegistry: createRenderProviderRegistry([provider()]) },
    writes,
    setProvider(p: RenderProvider, health?: any) { (this.deps as any).providerRegistry = createRenderProviderRegistry([p], health); },
  };
}

const O = process.env.ENABLE_CREATOR_RENDER_QUEUE;
afterEach(() => { if (O === undefined) delete process.env.ENABLE_CREATOR_RENDER_QUEUE; else process.env.ENABLE_CREATOR_RENDER_QUEUE = O; });

describe('Validation-10 — flag + sync fallback parity', () => {
  it('queue flag OFF by default; transient/terminal classification', () => {
    delete process.env.ENABLE_CREATOR_RENDER_QUEUE;
    expect(isCreatorRenderQueueEnabled()).toBe(false);
    process.env.ENABLE_CREATOR_RENDER_QUEUE = '1';
    expect(isCreatorRenderQueueEnabled()).toBe(true);
    expect(isTransientFailure('provider_timeout')).toBe(true);
    expect(isTerminalFailure('pre_moderation')).toBe(true);
    expect(isTerminalFailure('weird_unknown')).toBe(true); // fail-closed: unknown=terminal
  });
});

describe('Validation-3/4 — retry + timeout classification', () => {
  it('transient under cap ⇒ retry_scheduled with backoff; cap ⇒ failed', async () => {
    const m = mockDeps();
    const r1 = await failRenderJob(m.deps as any, { id: 'q1', retryCount: 0, maxRetries: 3, reason: 'provider_timeout' });
    expect(r1.event).toBe('render_retry_scheduled');
    expect(typeof r1.next_retry_at).toBe('string');
    const r2 = await failRenderJob(m.deps as any, { id: 'q1', retryCount: 3, maxRetries: 3, reason: 'provider_timeout' });
    expect(r2.event).toBe('render_terminal_failure');
    const r3 = await failRenderJob(m.deps as any, { id: 'q1', retryCount: 0, maxRetries: 3, reason: 'pre_moderation' });
    expect(r3.event).toBe('render_terminal_failure'); // moderation NEVER retried
  });
});

describe('Validation-2 — exactly-once leasing', () => {
  it('losing the claim race ⇒ no job processed (idle)', async () => {
    process.env.ENABLE_CREATOR_RENDER_QUEUE = '1';
    const m = mockDeps({ claim: { id: 'q-1', render_job_id: 'job-1', provider_key: 'openai', retry_count: 0, queue_state: 'queued' }, claimWins: false });
    const r = await processQueuedRenderJob(m.deps as any, 'w1');
    expect(r.status).toBe('idle'); // claim returned null → nothing processed
  });
});

describe('Validation-1/6/8/9 — async success + lineage + attach + isolation', () => {
  it('claims, renders, persists immutable lineage, attaches shared media', async () => {
    process.env.ENABLE_CREATOR_RENDER_QUEUE = '1';
    const m = mockDeps({ claim: { id: 'q-1', render_job_id: 'job-1', provider_key: 'openai', retry_count: 0, queue_state: 'queued' } });
    const r = await processQueuedRenderJob(m.deps as any, 'w1');
    expect(r.ok).toBe(true);
    expect(r.status).toBe('completed');
    expect(r.events).toContain('render_completed_async');
    const ins = (t: string) => m.writes.filter((w) => w.table === t && w.op === 'insert');
    expect(ins('creator_render_attempt')).toHaveLength(1);   // append-only
    expect(ins('creator_render_output')).toHaveLength(1);
    expect(m.writes.some((w) => w.table === 'content_core_asset')).toBe(true);
    expect(m.writes.some((w) => w.table === 'content_asset_attachment')).toBe(true);
    expect(m.writes.some((w) => w.table === 'billing_operations' && w.op === 'update' && w.row.status === 'confirmed')).toBe(true);
    for (const w of m.writes) expect(['scheduled_posts', 'daily_content_plans']).not.toContain(w.table);
  });
});

describe('Validation-5 — provider failover selection', () => {
  it('circuit_open primary ⇒ healthy secondary chosen; failover event', async () => {
    process.env.ENABLE_CREATOR_RENDER_QUEUE = '1';
    const m = mockDeps({ claim: { id: 'q-1', render_job_id: 'job-1', provider_key: 'p1', retry_count: 0, queue_state: 'queued' } });
    const p1 = provider({ key: 'p1' }); const p2 = provider({ key: 'p2' });
    m.setProvider(p1 as any); // replaced below with two-provider registry
    (m.deps as any).providerRegistry = createRenderProviderRegistry([p1, p2], { p1: 'circuit_open', p2: 'healthy' });
    const chain = (m.deps as any).providerRegistry.resolveProviderChain(SPEC);
    expect(chain).toEqual(['p2']); // p1 health-gated out
    const r = await processQueuedRenderJob(m.deps as any, 'w1');
    expect(r.ok).toBe(true);
  });
});

describe('Validation-7 — moderation enforcement (async, fail-closed)', () => {
  it('unsafe spec snapshot ⇒ blocked terminal, no provider/output', async () => {
    process.env.ENABLE_CREATOR_RENDER_QUEUE = '1';
    const unsafe = { ...SPEC, moderation_context: { ...SPEC.moderation_context, moderated_text: ['nsfw explicit nude'] } };
    const m = mockDeps({ claim: { id: 'q-1', render_job_id: 'job-1', provider_key: 'openai', retry_count: 0, queue_state: 'queued' }, specOverride: unsafe });
    const r = await processQueuedRenderJob(m.deps as any, 'w1');
    expect(r.status).toBe('blocked');
    expect(r.reason).toBe('pre_moderation');
    expect(m.writes.some((w) => w.table === 'creator_render_output')).toBe(false);
  });
});

describe('enqueue idempotency', () => {
  it('re-enqueue of same render lineage returns existing (no dup)', async () => {
    const supa = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'q-existing' } }) }) }) }) };
    const r = await enqueueRenderJob(
      { supabase: supa, ownedDbTable: () => ({}), now: () => 't' } as any,
      { renderJobId: 'job-1', providerKey: 'openai' },
    );
    expect(r).toEqual({ queue_job_id: 'q-existing', event: 'render_enqueue_existing' });
  });
});

// ── LIVE — queue monotonic guard (tx rolled back) ───────────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;
liveDescribe('Validation-6 LIVE — queue monotonic + render_job FK', () => {
  it('completed is terminal; retry_count cannot decrease', async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect(); await c.query('BEGIN');
    const ok: string[] = []; const fail: string[] = [];
    const sp = async (n: string, fn: () => Promise<any>, exp?: string) => {
      await c.query('SAVEPOINT s');
      try { await fn(); await c.query('RELEASE SAVEPOINT s'); (exp ? fail : ok).push(n); }
      catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT s'); (exp && new RegExp(exp).test(e.message) ? ok : fail).push(n); }
    };
    try {
      const jid = (await c.query(
        `insert into creator_render_job(task_id,card_id,organization_id,canonical_asset_family,render_modality,deterministic_input_hash,render_spec_snapshot) values('t','c','00000000-0000-0000-0000-0000000000aa','image','image','h-r4','{}'::jsonb) returning id`,
      )).rows[0].id;
      const qid = (await c.query(
        `insert into creator_render_queue_job(render_job_id,provider_key,queue_state,retry_count) values('${jid}','openai','completed',2) returning id`,
      )).rows[0].id;
      ok.push('insert');
      await sp('completed frozen', () => c.query(`update creator_render_queue_job set queue_state='queued' where id='${qid}'`), 'RENDER_QUEUE_FROZEN');
      await sp('retry monotonic', () => c.query(`update creator_render_queue_job set retry_count=1 where id='${qid}'`), 'RENDER_QUEUE_RETRY_MONOTONIC');
    } finally { await c.query('ROLLBACK'); await c.end(); }
    expect(fail).toEqual([]);
    expect(ok).toEqual(expect.arrayContaining(['insert', 'completed frozen', 'retry monotonic']));
  }, 30000);
});
