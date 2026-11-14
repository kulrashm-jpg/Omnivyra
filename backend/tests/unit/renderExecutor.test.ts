/**
 * Validation — Step-R3 first real rendering runtime.
 *
 *   1  successful image render
 *   2  immutable lineage correctness (job/variant/attempt/output inserts;
 *      LIVE: UPDATE blocked)
 *   3  billing HOLD/CONFIRM/RELEASE
 *   4  moderation enforcement (pre + post, fail-closed)
 *   5  duplicate-render reuse
 *   6  workspace attachment (shared-media lineage)
 *   7  shared-media inheritance compatibility (attachment shape)
 *   8  scheduler isolation (no scheduler/Text writes)
 *   9  feature-flag OFF parity
 *   10 backward compatibility (image-only / no-provider fail-closed)
 *
 * Provider + DB are mocked (DI) — no network, no real OpenAI. One LIVE
 * micro-check re-confirms render_job immutability (tx + rollback).
 */

import { executeRenderJob, isCreatorRenderingEnabled } from '../../services/creator/rendering';
import type { RenderProvider, RenderProviderRegistry } from '../../services/creator/rendering';

const FLAG = 'ENABLE_CREATOR_RENDERING';

/** A render-safe-ish workspace task (Step-8 shape, image family). */
const TASK = {
  asset_family: 'image',
  production_context: {
    asset_family: 'image',
    storyboard: [{ subject: 'a calm modern office, data dashboard on screen' }],
    overlays: ['Turn data into decisions'],
    pacing_guidance: '', scene_direction: 'clean corporate photography, soft light',
  },
  packaging_context: { caption: 'From data to decisions' },
};

function mockProvider(over: Partial<RenderProvider> = {}): RenderProvider {
  return {
    key: 'openai',
    capabilities: () => ({
      modalities: ['image'], max_duration_sec: 0, resolutions: [{ w: 1024, h: 1024 }],
      aspect_ratios: ['1:1'], supports_seed: false, supports_audio: false,
      supports_overlay_text: false, supports_batch: false, max_concurrent: 2,
    }),
    supports: () => true,
    estimateCost: () => ({ estimated_credits: 5, currency: 'CREDITS' }),
    submit: async () => ({ provider: 'openai', external_job_id: 'x', provider_metadata: { url: 'https://cdn/rendered.png' } }),
    poll: async (h) => ({ handle: h, state: 'succeeded', progress: 1 }),
    fetchOutput: async (h) => ({
      output_id: 'out:x', content_sha256: '', storage_ref: String((h.provider_metadata as any).url),
      modality: 'image', mime_type: 'image/png', byte_size: 0, version: 1, derived_from_output_id: null,
    }),
    cancel: async () => undefined,
    ...over,
  };
}
function registryOf(p: RenderProvider | null): RenderProviderRegistry {
  return {
    get: () => p ?? undefined,
    list: () => (p ? [p] : []),
    resolveProviderChain: (spec) => (p && p.supports(spec) ? [p.key] : []),
  };
}

/** In-memory supabase + ownedDbTable. Records every write for asserts. */
function mockDeps(opts: {
  existingJob?: any; existingOutput?: any; attachedOutputId?: string | null; otherOutputs?: any[];
  jobState?: { current_state: string; retry_count: number } | null; jobStateError?: any; casRows?: any[]; existingVariant?: any;
  /** creator_render_attempt rows that exist before this request (default: jobState.retry_count). */
  priorProviderCalls?: number; countError?: boolean; noStateRow?: boolean; variantReadError?: any;
  insertErrors?: Record<string, any>; upsertErrors?: Record<string, any>; updateErrors?: Record<string, any>;
} = {}) {
  const tables: Record<string, any[]> = {};
  const writes: { table: string; op: string; row?: any }[] = [];
  let seq = 0;
  // Every output in the table, oldest first. A query BY ID finds that row; an UNFILTERED "latest"
  // query (the old reuse path) gets the newest row of ANY job or tenant.
  const outputs: any[] = [...(opts.existingOutput ? [opts.existingOutput] : []), ...(opts.otherOutputs ?? [])];
  const attachedOutputId = opts.attachedOutputId !== undefined ? opts.attachedOutputId : (opts.existingOutput?.id ?? null);
  const reader = (table: string) => {
    const q: any = { _t: table, _f: {} as any };
    q.select = () => q; q.order = () => q; q.limit = () => q;
    q.eq = (k: string, v: any) => { q._f[k] = v; return q; };
    // A HEAD count (.select('id', { count: 'exact', head: true }).eq(...)) is awaited directly.
    q.then = (resolve: (v: unknown) => unknown) => resolve(table === 'creator_render_attempt'
      ? (opts.countError
        ? { count: null, error: { code: 'XX000', message: 'count failed' } }
        : { count: (opts.priorProviderCalls ?? opts.jobState?.retry_count ?? 0) + (tables.creator_render_attempt?.length ?? 0), error: null })
      : { data: null, error: null });
    q.maybeSingle = async () => {
      if (table === 'creator_render_job') return { data: opts.existingJob ?? null };
      if (table === 'creator_render_job_state') {
        if (opts.jobStateError) return { data: null, error: opts.jobStateError };
        if (opts.noStateRow) return { data: null, error: null };
        return { data: opts.existingJob && q._f.render_job_id === opts.existingJob.id ? { attached_output_id: attachedOutputId, ...(opts.jobState ?? {}) } : null, error: null };
      }
      if (table === 'creator_render_variant') {
        if (opts.variantReadError) return { data: null, error: opts.variantReadError };
        return { data: opts.existingVariant ?? null, error: null };
      }
      if (table === 'creator_render_output') {
        if (q._f.id !== undefined) return { data: outputs.find((o) => o.id === q._f.id) ?? null };
        return { data: outputs.length ? outputs[outputs.length - 1] : null };
      }
      return { data: null };
    };
    return q;
  };
  const writer = (table: string) => {
    const q: any = { _t: table };
    q.insert = (row: any) => {
      const rec = Array.isArray(row) ? row[0] : row;
      const err = opts.insertErrors?.[table];
      if (err) {
        // PostgREST: {data: null, error}, never a throw; nothing is stored.
        writes.push({ table, op: 'insert_failed', row: rec });
        return { select: () => ({ single: async () => ({ data: null, error: err }) }), then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: err }) };
      }
      const withId = { id: `${table}-${++seq}`, ...rec };
      (tables[table] ||= []).push(withId);
      writes.push({ table, op: 'insert', row: withId });
      return { select: () => ({ single: async () => ({ data: withId }) }), then: (resolve: (v: unknown) => unknown) => resolve({ data: withId, error: null }) };
    };
    q.update = (patch: any) => {
      const filters: Record<string, any> = {};
      writes.push({ table, op: 'update', row: patch, filters } as any);
      const chain: any = {
        eq: (k: string, v: any) => { filters[k] = v; return chain; },
        // A conditional transition (.eq(...).eq('current_state', ...).select()) reports the rows it moved.
        select: async () => ({ data: opts.casRows ?? [{ render_job_id: filters.render_job_id }], error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ error: opts.updateErrors?.[table] ?? null }),
      };
      return chain;
    };
    q.upsert = (row: any) => {
      const err = opts.upsertErrors?.[table];
      if (err) {
        writes.push({ table, op: 'upsert_failed', row });
        return { error: err, data: null, select: () => ({ single: async () => ({ data: null, error: err }) }) };
      }
      (tables[table] ||= []).push(row);
      writes.push({ table, op: 'upsert', row });
      return { error: null, select: () => ({ single: async () => ({ data: { id: `${table}-u` } }) }) };
    };
    return q;
  };
  const supabase = { from: reader, rpc: async () => ({ data: {} }) };
  return {
    deps: { supabase, ownedDbTable: writer, providerRegistry: registryOf(mockProvider()), now: () => '2026-05-16T00:00:00Z' },
    tables, writes,
    setProvider(p: RenderProvider | null) { (this.deps as any).providerRegistry = registryOf(p); },
  };
}
const ARGS = { workspaceTaskLike: TASK, platform: 'instagram', organizationId: 'org-1', contentCoreId: 'core-1', createdBy: 'u1' };

const O = process.env[FLAG];
afterEach(() => { if (O === undefined) delete process.env[FLAG]; else process.env[FLAG] = O; });

describe('Validation-9 — feature-flag OFF parity', () => {
  it('flag OFF ⇒ skipped, zero side effects', async () => {
    delete process.env[FLAG];
    expect(isCreatorRenderingEnabled()).toBe(false);
    const m = mockDeps();
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('skipped');
    expect(m.writes).toHaveLength(0);
  });
});

describe('Validation-1/2/3/6/7/8 — successful render end-to-end', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });
  it('renders, persists immutable lineage, bills, attaches shared media', async () => {
    const m = mockDeps();
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('completed');
    expect(r.output?.storage_ref).toBe('https://cdn/rendered.png');
    expect(r.events).toEqual(expect.arrayContaining([
      'render_started', 'billing_hold_created', 'billing_confirmed',
      'media_lineage_attached', 'render_completed',
    ]));
    const inserted = (t: string) => m.writes.filter((w) => w.table === t && w.op === 'insert');
    expect(inserted('creator_render_job')).toHaveLength(1);
    expect(inserted('creator_render_variant')).toHaveLength(1);
    expect(inserted('creator_render_attempt')).toHaveLength(1);
    expect(inserted('creator_render_output')).toHaveLength(1);
    // render_spec_snapshot persisted immutably
    expect(inserted('creator_render_job')[0]!.row.render_spec_snapshot.spec_id)
      .toMatch(/^render:[0-9a-f]{64}$/);
    // billing HOLD then CONFIRM
    const billing = m.writes.filter((w) => w.table === 'billing_operations');
    expect(billing[0]!.row.status).toBe('held');
    expect(billing.some((w) => w.op === 'update' && w.row.status === 'confirmed')).toBe(true);
    // shared-media attach (Step-15/16 compatible: asset_url set)
    const cca = m.writes.find((w) => w.table === 'content_core_asset');
    expect(cca!.row.asset_url).toBe('https://cdn/rendered.png');
    expect(m.writes.some((w) => w.table === 'content_asset_attachment')).toBe(true);
    // Scheduler isolation: NOTHING written to scheduler/Text tables
    for (const w of m.writes) {
      expect(['scheduled_posts', 'daily_content_plans']).not.toContain(w.table);
    }
  });
});

describe('Validation-3/4 — billing RELEASE + moderation enforcement', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });

  it('provider failure ⇒ HOLD released, failed, no output', async () => {
    const m = mockDeps();
    m.setProvider(mockProvider({ submit: async () => { throw new Error('provider down'); } }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.events).toEqual(expect.arrayContaining(['billing_hold_created', 'billing_released', 'provider_rejected']));
    expect(m.writes.some((w) => w.table === 'creator_render_output')).toBe(false);
  });

  it('unsafe prompt ⇒ pre-moderation blocks BEFORE billing/job', async () => {
    const m = mockDeps();
    const r = await executeRenderJob(m.deps as any, {
      ...ARGS,
      workspaceTaskLike: {
        ...TASK,
        production_context: { ...TASK.production_context, scene_direction: 'nsfw explicit nude content' },
      },
    });
    expect(r.status).toBe('blocked');
    expect(r.events).toContain('moderation_blocked');
    expect(m.writes.some((w) => w.table === 'billing_operations')).toBe(false);
    expect(m.writes.some((w) => w.table === 'creator_render_job')).toBe(false);
  });
});

describe('Validation-5 — duplicate-render reuse', () => {
  it('existing job for same org+hash ⇒ reused, no new billing/job', async () => {
    process.env[FLAG] = '1';
    const m = mockDeps({
      existingJob: { id: 'job-existing' },
      existingOutput: { id: 'out-existing', storage_ref: 'https://cdn/old.png', content_sha256: 'h', attempt_id: 'a' },
    });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('reused');
    expect(r.events).toContain('duplicate_render_reused');
    expect(m.writes.some((w) => w.table === 'billing_operations')).toBe(false);
    expect(m.writes.some((w) => w.table === 'creator_render_attempt')).toBe(false);
    // still (idempotently) ensures shared-media lineage exists
    expect(m.writes.some((w) => w.table === 'content_core_asset')).toBe(true);
  });
});

describe('Validation-10 — backward compatibility (fail-closed)', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });
  it('non-image asset ⇒ failed image_only, no billing/job', async () => {
    const m = mockDeps();
    const r = await executeRenderJob(m.deps as any, {
      ...ARGS,
      workspaceTaskLike: { ...TASK, asset_family: 'video', production_context: { ...TASK.production_context, asset_family: 'video' } },
    });
    expect(r.ok).toBe(false);
    expect(['image_only_this_step', 'projection_failed', 'TEXT_LIKE_NOT_RENDERABLE', 'RENDER_CAPABILITY_NONE'])
      .toContain(r.reason);
    expect(m.writes).toHaveLength(0);
  });
  it('no capable provider ⇒ provider_rejected, no billing', async () => {
    const m = mockDeps(); m.setProvider(null);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('failed');
    expect(r.events).toContain('provider_rejected');
    expect(m.writes.some((w) => w.table === 'billing_operations')).toBe(false);
  });
});

// ── LIVE — render_job lineage immutability re-confirmed ──────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;
liveDescribe('Validation-2 LIVE — render_job immutable', () => {
  it('UPDATE on creator_render_job blocked (tx rolled back)', async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect(); await c.query('BEGIN');
    let blocked = false;
    try {
      const id = (await c.query(
        `insert into creator_render_job(task_id,card_id,organization_id,canonical_asset_family,render_modality,deterministic_input_hash,render_spec_snapshot) values('t','c','00000000-0000-0000-0000-0000000000aa','image','image','h-r3','{}'::jsonb) returning id`,
      )).rows[0].id;
      try { await c.query(`update creator_render_job set task_id='x' where id='${id}'`); }
      catch (e: any) { blocked = /LEDGER_IMMUTABLE/.test(e.message); }
    } finally { await c.query('ROLLBACK'); await c.end(); }
    expect(blocked).toBe(true);
  }, 30000);
});

// ── Control RPCs and the billing hold are CHECKED, not discarded (e9 rulings, 2026-11-11) ─────────
// supabase-js returns { data, error } and does not throw on a database error, so the old
// `try { await rpc() } catch {}` and the unchecked billing insert were silent.
describe('control RPCs and billing hold fail closed', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });

  /** The provider records whether it was ever called. */
  const watched = () => { const calls = { submit: 0 }; return { calls, p: mockProvider({ submit: async (...a: any[]) => { calls.submit += 1; return mockProvider().submit(...(a as [any, any])); } }) }; };
  const withRpc = (m: ReturnType<typeof mockDeps>, rpc: (name: string, args: any) => Promise<any>) => {
    (m.deps as any).supabase = { ...(m.deps as any).supabase, rpc };
  };
  const withBillingInsert = (m: ReturnType<typeof mockDeps>, result: { data: any; error: any }) => {
    const orig = (m.deps as any).ownedDbTable;
    (m.deps as any).ownedDbTable = (t: string) => {
      const q = orig(t);
      if (t === 'billing_operations') q.insert = () => ({ select: () => ({ single: async () => result }) });
      return q;
    };
  };

  it('billing hold insert ERROR: the provider is never called; retryable failure', async () => {
    const m = mockDeps(); const w = watched(); m.setProvider(w.p);
    withBillingInsert(m, { data: null, error: { code: '08006', message: 'connection lost' } });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, status: 'failed', reason: 'billing_hold_unavailable', retryable: true });
    expect(r.events).toEqual(expect.arrayContaining(['billing_hold_failed', 'render_failed']));
    expect(w.calls.submit).toBe(0);
    // The job exists first now, so the failure consumes attempt 1 and the next request retries as attempt 2.
    expect(m.writes.filter((x) => x.table === 'creator_render_job_state' && x.op === 'update').map((x) => x.row))
      .toEqual(expect.arrayContaining([expect.objectContaining({ current_state: 'retry_scheduled', retry_count: 1 })]));
  });

  it('billing hold unique CONFLICT (23505): refused, not retryable as is, provider never called', async () => {
    const m = mockDeps(); const w = watched(); m.setProvider(w.p);
    withBillingInsert(m, { data: null, error: { code: '23505', message: 'duplicate key' } });
    const r = await executeRenderJob(m.deps as any, ARGS);
    // The key is tenant- AND attempt-scoped, so a conflict consumes this attempt; the retry uses attempt 2's key.
    expect(r).toMatchObject({ ok: false, reason: 'billing_hold_conflict', retryable: true });
    expect(w.calls.submit).toBe(0);
  });

  it('CONTROL: a created billing hold lets the render reach the provider (the refusal above is the hold, not the harness)', async () => {
    const m = mockDeps(); const w = watched(); m.setProvider(w.p);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('completed');
    expect(w.calls.submit).toBe(1);
  });

  it.each([
    ['returns an error', async () => ({ data: null, error: { code: '57014', message: 'canceling statement' } })],
    ['throws', async () => { throw new Error('network'); }],
  ])('claim_job_execution %s: refused BEFORE any billing hold or provider call; retryable', async (_l, claim) => {
    const m = mockDeps(); const w = watched(); m.setProvider(w.p);
    withRpc(m, async (name) => (name === 'claim_job_execution' ? claim() : { data: {}, error: null }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, status: 'failed', reason: 'execution_registry_unavailable', retryable: true });
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
    expect(w.calls.submit).toBe(0);
  });

  it('claim reports this ATTEMPT key already terminal: the attempt is consumed (retry_scheduled), nothing billed or rendered; the next request runs attempt 2', async () => {
    const m = mockDeps(); const w = watched(); m.setProvider(w.p);
    withRpc(m, async (name) => (name === 'claim_job_execution'
      ? { data: { status: 'released', is_terminal: true }, error: null } : { data: {}, error: null }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await executeRenderJob(m.deps as any, ARGS);
    err.mockRestore();
    expect(r).toMatchObject({ ok: false, status: 'failed', reason: 'execution_already_terminal', retryable: true });
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
    expect(w.calls.submit).toBe(0);
    expect(m.writes.filter((x) => x.table === 'creator_render_job_state' && x.op === 'update').map((x) => x.row))
      .toEqual(expect.arrayContaining([expect.objectContaining({ current_state: 'retry_scheduled', retry_count: 1 })]));
  });

  it('TENANT-SCOPED keys: two organisations rendering IDENTICAL content get distinct registry hashes and billing keys, and both render', async () => {
    const keys: Record<string, { claim: string; billing: string; attempt: string }> = {};
    for (const org of ['org-A', 'org-B']) {
      const m = mockDeps(); const w = watched(); m.setProvider(w.p);
      let claimHash = '';
      withRpc(m, async (name, a) => { if (name === 'claim_job_execution') claimHash = a.p_execution_hash; return { data: {}, error: null }; });
      const r = await executeRenderJob(m.deps as any, { ...ARGS, organizationId: org });
      expect(r.status).toBe('completed');
      expect(w.calls.submit).toBe(1);
      const billing = m.writes.find((x) => x.table === 'billing_operations' && x.op === 'insert')!.row.idempotency_key;
      const attempt = m.writes.find((x) => x.table === 'creator_render_attempt' && x.op === 'insert')!.row.execution_hash;
      keys[org] = { claim: claimHash, billing, attempt };
    }
    expect(keys['org-A'].claim).not.toBe(keys['org-B'].claim);
    expect(keys['org-A'].billing).not.toBe(keys['org-B'].billing);
    expect(keys['org-A'].attempt).not.toBe(keys['org-B'].attempt);
    expect(keys['org-A'].billing).toMatch(/^render:org-A:render:[0-9a-f]{64}$/);
    expect(keys['org-A'].claim).toMatch(/^org-A:[0-9a-f]{64}$/);
  });

  it('NO DOUBLE CHARGE across the key-format change: a spec rendered + billed BEFORE it is found by the UNCHANGED (organization_id, deterministic_input_hash) job dedupe, before any claim or billing', async () => {
    // The tenant-scoped formats changed ONLY the registry, billing and attempt keys. The reuse lookup is
    // creator_render_job (UNIQUE (organization_id, deterministic_input_hash)), whose key did not change,
    // and it runs BEFORE the claim and the billing hold. So a pre-deploy success (old-format registry and
    // billing rows) is reused: nothing is claimed, held, billed or rendered again.
    const m = mockDeps({
      existingJob: { id: 'job-before-deploy' },
      existingOutput: { id: 'out-before', storage_ref: 'https://cdn/before.png', content_sha256: 'h', attempt_id: 'a' },
    });
    const w = watched(); m.setProvider(w.p);
    const filters: Record<string, unknown>[] = [];
    const origFrom = (m.deps as any).supabase.from;
    const rpcNames: string[] = [];
    (m.deps as any).supabase = {
      ...(m.deps as any).supabase,
      from: (t: string) => { const q = origFrom(t); if (t === 'creator_render_job') filters.push(q._f); return q; },
      rpc: async (name: string) => { rpcNames.push(name); return { data: {}, error: null }; },
    };
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('reused');
    const f = filters[0] as Record<string, unknown>;
    expect(f.organization_id).toBe(ARGS.organizationId);
    expect(String(f.deterministic_input_hash)).toMatch(/^[0-9a-f]{64}$/);   // the BARE hash: the unchanged key
    expect(rpcNames).not.toContain('claim_job_execution');
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
    expect(w.calls.submit).toBe(0);
  });

  it("SECURITY: the reuse output is THIS job's attached output, never another tenant's newer output", async () => {
    const mine = { id: 'out-mine', storage_ref: 'https://cdn/mine.png', content_sha256: 'h1', attempt_id: 'a1' };
    const foreignNewer = { id: 'out-tenant-B', storage_ref: 'https://cdn/tenant-B-private.png', content_sha256: 'h2', attempt_id: 'aB' };
    const m = mockDeps({ existingJob: { id: 'job-mine' }, existingOutput: mine, otherOutputs: [foreignNewer] });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('reused');
    expect(r.output?.output_id).toBe('out-mine');
    const attached = JSON.stringify(m.writes.filter((x) => x.table === 'content_core_asset' || x.table === 'content_asset_attachment'));
    expect(attached).not.toContain('tenant-B-private');
    expect(attached).toContain('https://cdn/mine.png');
  });

  it('SECURITY: an existing job with NO attached output attaches NOTHING (no foreign output, no "latest" fallback)', async () => {
    const foreignNewer = { id: 'out-tenant-B', storage_ref: 'https://cdn/tenant-B-private.png', content_sha256: 'h2', attempt_id: 'aB' };
    const m = mockDeps({ existingJob: { id: 'job-mine' }, attachedOutputId: null, otherOutputs: [foreignNewer] });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.output ?? null).toBeNull();
    expect(r.attached ?? false).toBe(false);
    expect(r.ok).toBe(false);                       // never an empty "reused"
    expect(JSON.stringify(m.writes)).not.toContain('tenant-B-private');
  });

  // ── Provider-failure RETRY under a new attempt (e9 ruling on item 5, K = 3) ─────────────────────────
  const stateUpdates = (m: ReturnType<typeof mockDeps>) => m.writes.filter((x) => x.table === 'creator_render_job_state' && x.op === 'update').map((x) => x.row);

  it('RETRY: a provider failure on the FIRST attempt is retry_scheduled (retry_count 1), hold RELEASED, retryable', async () => {
    const m = mockDeps(); m.setProvider(mockProvider({ submit: async () => { throw new Error('provider down'); } }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'provider_failed', retryable: true });
    expect(stateUpdates(m)).toEqual(expect.arrayContaining([expect.objectContaining({ current_state: 'retry_scheduled', retry_count: 1 })]));
    expect(m.writes.some((x) => x.table === 'billing_operations' && x.op === 'update' && x.row.status === 'released')).toBe(true);
    expect(m.writes.some((x) => x.table === 'billing_operations' && x.row?.status === 'confirmed')).toBe(false);
  });

  it('RETRY: the next request for that content re-runs it as attempt 2 on the SAME job, with attempt-specific keys, billed ONCE (for itself)', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 1 }, existingVariant: { id: 'var-1' } });
    const w = watched(); m.setProvider(w.p);
    let claimHash = '';
    withRpc(m, async (name, a) => { if (name === 'claim_job_execution') claimHash = a.p_execution_hash; return { data: {}, error: null }; });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: true, status: 'completed', render_job_id: 'job-1' });
    expect(w.calls.submit).toBe(1);
    expect(m.writes.some((x) => x.table === 'creator_render_job' && x.op === 'insert')).toBe(false);   // same job
    const attempt = m.writes.find((x) => x.table === 'creator_render_attempt')!.row;
    expect(attempt).toMatchObject({ variant_id: 'var-1', attempt_number: 2 });
    expect(attempt.execution_hash).toMatch(/:a2$/);
    const holds = m.writes.filter((x) => x.table === 'billing_operations' && x.op === 'insert');
    expect(holds).toHaveLength(1);
    expect(holds[0]!.row.idempotency_key).toMatch(/:a2$/);
    expect(claimHash).toMatch(/:a2$/);
    expect(stateUpdates(m)[0]).toMatchObject({ current_state: 'preparing' });   // CAS retry_scheduled -> preparing
  });

  it('RETRY: concurrent retries -> ONE provider call; the loser of the conditional transition is refused before any hold', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 1 }, existingVariant: { id: 'var-1' }, casRows: [] });
    const w = watched(); m.setProvider(w.p);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'retry_in_progress', retryable: true });
    expect(w.calls.submit).toBe(0);
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
  });

  it('RETRY: the K-th (3rd) provider failure is failed_provider_exhausted (terminal), not retryable', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 2 }, existingVariant: { id: 'var-1' } });
    m.setProvider(mockProvider({ submit: async () => { throw new Error('provider down'); } }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'provider_failed:attempts_exhausted', retryable: false });
    expect(stateUpdates(m)).toEqual(expect.arrayContaining([expect.objectContaining({ current_state: 'failed_provider_exhausted', retry_count: 3 })]));
  });

  it('RETRY: MODERATION failures never retry (failed_moderation_post stays terminal; a later request reuses nothing and renders nothing)', async () => {
    const blocked = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'failed_moderation_post', retry_count: 0 } });
    const w = watched(); blocked.setProvider(w.p);
    const r = await executeRenderJob(blocked.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'render_terminal:failed_moderation_post', retryable: false });
    expect(r.output ?? null).toBeNull();
    expect(w.calls.submit).toBe(0);
  });

  it('an existing job STILL IN PROGRESS is refused render_in_progress (retryable), never an empty reuse, nothing billed', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'rendering', retry_count: 0 } });
    const w = watched(); m.setProvider(w.p);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'render_in_progress', retryable: true });
    expect(w.calls.submit).toBe(0);
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
  });

  it('a CONCURRENT first render loses at the UNIQUE job insert (23505): refused before any claim, hold or provider call', async () => {
    const m = mockDeps(); const w = watched(); m.setProvider(w.p);
    const rpcNames: string[] = [];
    withRpc(m, async (name) => { rpcNames.push(name); return { data: {}, error: null }; });
    const orig = (m.deps as any).ownedDbTable;
    (m.deps as any).ownedDbTable = (t: string) => {
      const q = orig(t);
      if (t === 'creator_render_job') q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }) });
      return q;
    };
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'render_in_progress', retryable: true });
    expect(rpcNames).not.toContain('claim_job_execution');
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
    expect(w.calls.submit).toBe(0);
  });

  it('a LEGACY frozen failed_render job (pre-retry) is refused render_terminal (not retryable), never an empty reuse', async () => {
    const m = mockDeps({ existingJob: { id: 'job-old' }, attachedOutputId: null, jobState: { current_state: 'failed_render', retry_count: 0 } });
    const w = watched(); m.setProvider(w.p);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'render_terminal:failed_render', retryable: false });
    expect(w.calls.submit).toBe(0);
  });

  it('an UNREADABLE job state on a dedupe hit is refused (retryable), never an empty reuse (83 note)', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, jobStateError: { code: '08006', message: 'down' } });
    const w = watched(); m.setProvider(w.p);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, reason: 'render_state_unreadable', retryable: true });
    expect(w.calls.submit).toBe(0);
  });

  it('attempt insert fails: the provider is NEVER called, the hold is released, retryable', async () => {
    const m = mockDeps(); const w = watched(); m.setProvider(w.p);
    const orig = (m.deps as any).ownedDbTable;
    (m.deps as any).ownedDbTable = (t: string) => {
      const q = orig(t);
      if (t === 'creator_render_attempt') q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }) });
      return q;
    };
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, status: 'failed', reason: 'attempt_insert_failed', retryable: true });
    expect(w.calls.submit).toBe(0);
    expect(r.events).toEqual(expect.arrayContaining(['billing_released']));
  });

  it('advance_job_execution error: the performed, billed render still COMPLETES, and the failure is reported', async () => {
    const m = mockDeps();
    withRpc(m, async (name) => (name === 'advance_job_execution'
      ? { data: null, error: { code: 'P0001', message: 'JER_NOT_FOUND' } } : { data: {}, error: null }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('completed');
    expect(r.events).toEqual(expect.arrayContaining(['billing_confirmed', 'execution_registry_advance_failed', 'render_completed']));
    expect(err).toHaveBeenCalledWith('[creator-render] execution registry advance failed', expect.objectContaining({ status: 'completed' }));
    err.mockRestore();
  });
});

describe('05 review of eebd5e261: no freeze after the provider, a provider-only budget, checked lineage writes', () => {
  beforeEach(() => { process.env[FLAG] = '1'; });
  let err: jest.SpyInstance;
  beforeEach(() => { err = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { err.mockRestore(); });

  const stateUpdates = (m: ReturnType<typeof mockDeps>) => m.writes.filter((x) => x.table === 'creator_render_job_state' && x.op === 'update').map((x) => x.row);
  const lastState = (m: ReturnType<typeof mockDeps>) => stateUpdates(m).slice(-1)[0];
  const watched = (over: Partial<RenderProvider> = {}) => {
    const calls = { submit: 0 };
    const base = mockProvider(over);
    return { calls, p: { ...base, submit: async (...a: any[]) => { calls.submit += 1; return base.submit(...(a as [any, any])); } } as RenderProvider };
  };
  const recordRpc = (m: ReturnType<typeof mockDeps>) => {
    const names: { name: string; args: any }[] = [];
    (m.deps as any).supabase = { ...(m.deps as any).supabase, rpc: async (name: string, args: any) => { names.push({ name, args }); return { data: {}, error: null }; } };
    return names;
  };
  const released = (m: ReturnType<typeof mockDeps>) => m.writes.some((x) => x.table === 'billing_operations' && x.op === 'update' && x.row.status === 'released');
  const confirmed = (m: ReturnType<typeof mockDeps>) => m.writes.some((x) => x.table === 'billing_operations' && x.op === 'update' && x.row.status === 'confirmed');

  // ── Finding A ──────────────────────────────────────────────────────────────────────────────────
  it('A: an output insert ERROR after a successful provider call consumes the attempt (retry_scheduled), never leaves the job "rendering"', async () => {
    const m = mockDeps({ insertErrors: { creator_render_output: { code: '23514', message: 'check' } } });
    const w = watched(); m.setProvider(w.p);
    const rpc = recordRpc(m);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(w.calls.submit).toBe(1);
    expect(r).toMatchObject({ ok: false, status: 'failed', reason: 'output_insert_failed', retryable: true });
    expect(r.render_job_id).toBeTruthy();
    expect(lastState(m)).toMatchObject({ current_state: 'retry_scheduled', retry_count: 1 });
    expect(released(m)).toBe(true);
    expect(confirmed(m)).toBe(false);
    expect(rpc.some((c) => c.name === 'advance_job_execution' && c.args.p_status === 'released')).toBe(true);
  });

  it('A: an output insert error on the 3rd PROVIDER call exhausts the job (terminal)', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 2 }, existingVariant: { id: 'var-1' }, priorProviderCalls: 2, insertErrors: { creator_render_output: { code: 'XX000', message: 'x' } } });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ reason: 'output_insert_failed:attempts_exhausted', retryable: false });
    expect(lastState(m)).toMatchObject({ current_state: 'failed_provider_exhausted', retry_count: 3 });
  });

  it('A: an UNEXPECTED throw after the provider call goes through the attempt bookkeeping (job state written, render_job_id returned)', async () => {
    const m = mockDeps();
    m.setProvider(mockProvider({ fetchOutput: async () => ({ get storage_ref(): string { throw new Error('boom'); }, mime_type: 'image/png' } as any) }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: false, status: 'failed', reason: 'unexpected_error', retryable: true });
    expect(r.render_job_id).toBeTruthy();
    expect(lastState(m)).toMatchObject({ current_state: 'retry_scheduled', retry_count: 1 });
    expect(released(m)).toBe(true);
  });

  // ── Finding B ──────────────────────────────────────────────────────────────────────────────────
  it('B: failures that never reach the provider do NOT spend the budget (attempt 3 after two infra failures is not exhausted)', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 2 }, existingVariant: { id: 'var-1' }, priorProviderCalls: 0, insertErrors: { billing_operations: { code: 'XX000', message: 'down' } } });
    const w = watched(); m.setProvider(w.p);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(w.calls.submit).toBe(0);
    expect(r).toMatchObject({ reason: 'billing_hold_unavailable', retryable: true });
    expect(lastState(m)).toMatchObject({ current_state: 'retry_scheduled', retry_count: 3 });
  });

  it('B: a provider failure is judged on PROVIDER calls: attempt 6 with 1 earlier provider call is still retryable', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 5 }, existingVariant: { id: 'var-1' }, priorProviderCalls: 1 });
    m.setProvider(mockProvider({ submit: async () => { throw new Error('provider down'); } }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ reason: 'provider_failed', retryable: true });
    expect(lastState(m)).toMatchObject({ current_state: 'retry_scheduled', retry_count: 6 });
  });

  it('B: if the provider-call count cannot be read, the attempt NUMBER bounds it (errs toward stopping a paid provider)', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 2 }, existingVariant: { id: 'var-1' }, priorProviderCalls: 0, countError: true });
    m.setProvider(mockProvider({ submit: async () => { throw new Error('provider down'); } }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ reason: 'provider_failed:attempts_exhausted', retryable: false });
  });

  it('B: a variant READ error is refused BEFORE the claim and is not consumed (retry_count unchanged, nothing claimed or held)', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 1 }, variantReadError: { code: '57014', message: 'timeout' } });
    const w = watched(); m.setProvider(w.p);
    const rpc = recordRpc(m);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ reason: 'variant_unavailable', retryable: true });
    expect(rpc).toEqual([]);
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
    expect(w.calls.submit).toBe(0);
    expect(lastState(m).current_state).toBe('retry_scheduled');
    expect(lastState(m)).not.toHaveProperty('retry_count');
  });

  it('B: a retry whose variant row is MISSING (an earlier insert failed) creates it and renders', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 1 }, existingVariant: null, priorProviderCalls: 0 });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('completed');
    expect(m.writes.filter((x) => x.table === 'creator_render_variant' && x.op === 'insert')).toHaveLength(1);
  });

  it('B: a variant INSERT error is refused before the claim, not consumed', async () => {
    const m = mockDeps({ insertErrors: { creator_render_variant: { code: 'XX000', message: 'down' } } });
    const w = watched(); m.setProvider(w.p);
    const rpc = recordRpc(m);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ reason: 'variant_unavailable', retryable: true });
    expect(rpc).toEqual([]);
    expect(w.calls.submit).toBe(0);
    expect(lastState(m)).toMatchObject({ current_state: 'retry_scheduled' });
  });

  // ── the job-state row ───────────────────────────────────────────────────────────────────────────
  it('a job-state INSERT error on the first render is refused before any claim, hold or provider call', async () => {
    const m = mockDeps({ insertErrors: { creator_render_job_state: { code: 'XX000', message: 'down' } } });
    const w = watched(); m.setProvider(w.p);
    const rpc = recordRpc(m);
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ reason: 'job_state_unavailable', retryable: true });
    expect(rpc).toEqual([]);
    expect(m.writes.some((x) => x.table === 'billing_operations')).toBe(false);
    expect(w.calls.submit).toBe(0);
  });

  it('an ORPHAN job (no state row) is adopted as a retry, not read as "in progress" forever', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, noStateRow: true, existingVariant: { id: 'var-1' }, priorProviderCalls: 0 });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(m.writes.find((x) => x.table === 'creator_render_job_state' && x.op === 'insert')!.row).toMatchObject({ render_job_id: 'job-1', current_state: 'retry_scheduled', retry_count: 0 });
    expect(r.status).toBe('completed');
  });

  it('the retry transition is conditional on retry_count too (a stale reader cannot move a job another request advanced)', async () => {
    const m = mockDeps({ existingJob: { id: 'job-1' }, attachedOutputId: null, jobState: { current_state: 'retry_scheduled', retry_count: 2 }, existingVariant: { id: 'var-1' } });
    await executeRenderJob(m.deps as any, ARGS);
    const cas = m.writes.find((x) => x.table === 'creator_render_job_state' && x.op === 'update' && x.row.current_state === 'preparing') as any;
    expect(cas.filters).toMatchObject({ render_job_id: 'job-1', current_state: 'retry_scheduled', retry_count: 2 });
  });

  // ── billing writes ──────────────────────────────────────────────────────────────────────────────
  it('a billing RELEASE error is surfaced (billing_release_failed), not reported as released', async () => {
    const m = mockDeps({ updateErrors: { billing_operations: { code: 'XX000', message: 'down' } } });
    m.setProvider(mockProvider({ submit: async () => { throw new Error('provider down'); } }));
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.events).toContain('billing_release_failed');
    expect(r.events).not.toContain('billing_released');
  });

  it('a billing CONFIRM error on a delivered render is surfaced, the render completes, and the hold is NEVER released', async () => {
    const m = mockDeps({ updateErrors: { billing_operations: { code: 'XX000', message: 'down' } } });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('completed');
    expect(r.events).toContain('billing_confirm_failed');
    expect(r.events).not.toContain('billing_confirmed');
    expect(released(m)).toBe(false);
  });

  // ── Finding C ──────────────────────────────────────────────────────────────────────────────────
  it.each(['content_core_asset', 'content_asset_attachment'])('C: a lineage upsert error on %s reports attached:false, never media_lineage_attached', async (table) => {
    const m = mockDeps({ upsertErrors: { [table]: { code: '42501', message: 'denied' } } });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r).toMatchObject({ ok: true, status: 'completed', attached: false });
    expect(r.events).toContain('media_lineage_attach_failed');
    expect(r.events).not.toContain('media_lineage_attached');
    expect(confirmed(m)).toBe(true);
  });

  it('C: a reuse re-attempts the lineage and reports what landed', async () => {
    const out = { id: 'out-1', storage_ref: 's', content_sha256: 'h', attempt_id: 'a' };
    const failing = mockDeps({ existingJob: { id: 'job-1' }, existingOutput: out, upsertErrors: { content_core_asset: { code: 'XX000', message: 'down' } } });
    expect(await executeRenderJob(failing.deps as any, ARGS)).toMatchObject({ status: 'reused', attached: false });
    const healed = mockDeps({ existingJob: { id: 'job-1' }, existingOutput: out });
    expect(await executeRenderJob(healed.deps as any, ARGS)).toMatchObject({ status: 'reused', attached: true });
  });

  it('the success state write is CHECKED: a failure is surfaced (render_state_write_failed)', async () => {
    const m = mockDeps({ updateErrors: { creator_render_job_state: { code: 'XX000', message: 'down' } } });
    const r = await executeRenderJob(m.deps as any, ARGS);
    expect(r.status).toBe('completed');
    expect(r.events).toContain('render_state_write_failed');
  });
});
