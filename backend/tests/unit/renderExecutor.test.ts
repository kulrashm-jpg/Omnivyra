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
function mockDeps(opts: { existingJob?: any; existingOutput?: any } = {}) {
  const tables: Record<string, any[]> = {};
  const writes: { table: string; op: string; row?: any }[] = [];
  let seq = 0;
  const reader = (table: string) => {
    const q: any = { _t: table, _f: {} as any };
    q.select = () => q; q.order = () => q; q.limit = () => q;
    q.eq = (k: string, v: any) => { q._f[k] = v; return q; };
    q.maybeSingle = async () => {
      if (table === 'creator_render_job') return { data: opts.existingJob ?? null };
      if (table === 'creator_render_output') return { data: opts.existingOutput ?? null };
      return { data: null };
    };
    return q;
  };
  const writer = (table: string) => {
    const q: any = { _t: table };
    q.insert = (row: any) => {
      const rec = Array.isArray(row) ? row[0] : row;
      const withId = { id: `${table}-${++seq}`, ...rec };
      (tables[table] ||= []).push(withId);
      writes.push({ table, op: 'insert', row: withId });
      return { select: () => ({ single: async () => ({ data: withId }) }) };
    };
    q.update = (patch: any) => {
      writes.push({ table, op: 'update', row: patch });
      return { eq: () => ({ eq: async () => ({ error: null }) }), };
    };
    q.upsert = (row: any) => {
      (tables[table] ||= []).push(row);
      writes.push({ table, op: 'upsert', row });
      return { select: () => ({ single: async () => ({ data: { id: `${table}-u` } }) }) };
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
