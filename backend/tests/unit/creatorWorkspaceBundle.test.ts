/**
 * Validation — Step-12 multi-variant orchestration + collaboration.
 *
 *   1  multi-platform shared-core editing
 *   2  hybrid override persistence (survives sync + reload)
 *   3  synchronized propagation (non-overridden fields + lineage)
 *   4  stale-edit rejection (optimistic concurrency)
 *   5  deterministic reload (order-independent aggregation)
 *   6  variant aggregation correctness (card lineage / shared core)
 *   7  scheduler-boundary integrity (LIVE SQL)
 *   8  collaboration-safe saves (conflict surface)
 *   9  Text workspace isolation
 *   10 backward compatibility (single-variant / legacy)
 *
 * supabase mocked = purity proof.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure bundle layer'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import {
  buildCreatorBlueprintCard,
  expandCardToDailyTasks,
} from '../../services/creator/intelligence/planning';
import {
  toCreatorWorkspaceTask,
  toPersistableContent,
  applyWorkspaceEdits,
  aggregateCreatorBundle,
  syncSharedCoreEdits,
  detectBundleConflicts,
  StaleWorkspaceEditError,
} from '../../services/creator/intelligence/workspace';

const ADAPT = 'ENABLE_CREATOR_BLUEPRINT_ADAPTERS';
const SIX = ['LinkedIn', 'Instagram', 'facebook', 'TikTok', 'YouTube', 'X'];
const CTX = { now: '2026-05-16T00:00:00.000Z', editor: 'tester', change_source: 'unit' };

function cardInput(over: Record<string, unknown> = {}) {
  return {
    topic: 'From Data to Decisions', objective: 'Brand awareness',
    contentType: 'carousel', format: 'carousel', platforms: SIX,
    campaignTheme: 'Smarter marketing', creativeObjective: 'data-to-decision bridge',
    coreMessage: 'Turn analytics into decisions', tone: 'authoritative',
    cta: 'Book a walkthrough', campaignId: 'camp-123', weekIndex: 2,
    continuityContext: { campaign_id: 'camp-123', week_index: 2 },
    ...over,
  } as any;
}

/** card → expansion → workspace tasks → persisted rows (one per platform). */
function rowsFor(over: Record<string, unknown> = {}) {
  const card = buildCreatorBlueprintCard(cardInput(over));
  const exp = expandCardToDailyTasks(card);
  return exp.tasks.map((t, i) => {
    const ws = toCreatorWorkspaceTask(card, t);
    return {
      content: JSON.stringify(toPersistableContent(ws)),
      content_type: ws.asset_family,
      platform: ws.platform_context.platform,
      asset_type: ws.asset_family,
      intent_type: 'creator',
      week_number: 2,
      topic: 'From Data to Decisions',
      title: 'From Data to Decisions',
      __idx: i,
    };
  });
}

const O = process.env[ADAPT];
beforeEach(() => { process.env[ADAPT] = '1'; });
afterEach(() => {
  if (O === undefined) delete process.env[ADAPT]; else process.env[ADAPT] = O;
  fromSpy.mockClear();
});

describe('Validation-6/5 — aggregation correctness + determinism', () => {
  it('groups one card lineage; deterministic regardless of row order', () => {
    const rows = rowsFor({ distributionMode: 'shared' });
    const a = aggregateCreatorBundle(rows, { now: CTX.now })!;
    const b = aggregateCreatorBundle([...rows].reverse(), { now: CTX.now })!;
    expect(a.variants.length).toBe(6);
    expect(a.shared_core).not.toBeNull();
    expect(a.classification).toBe('shared_content');
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b)); // order-independent
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('platform_native → no shared core', () => {
    const bundle = aggregateCreatorBundle(rowsFor({ distributionMode: 'unique' }), { now: CTX.now })!;
    expect(bundle.classification).toBe('platform_native_content');
    expect(bundle.shared_core).toBeNull();
  });
});

describe('Validation-1/3 — shared-core editing + synchronized propagation', () => {
  it('propagates non-overridden fields to every variant + stamps lineage', () => {
    const bundle = aggregateCreatorBundle(rowsFor({ distributionMode: 'shared' }), { now: CTX.now })!;
    const { bundle: next, propagated_to } = syncSharedCoreEdits(
      bundle, { caption: 'UNIFIED CAPTION', cta: 'One CTA' }, CTX,
    );
    expect(propagated_to.length).toBe(5); // all except the core itself
    for (const v of next.variants) {
      expect(v.packaging_context.caption).toBe('UNIFIED CAPTION');
      expect(v.packaging_context.cta).toBe('One CTA');
    }
    expect(next.synchronization?.in_sync).toBe(true);
    const coreRev = next.synchronization!.core_revision;
    for (const v of next.variants) {
      if (v === next.shared_core) continue;
      expect(v.workspace_meta?.synced_from_core_revision).toBe(coreRev);
    }
  });
});

describe('Validation-2 — hybrid override survives sync + reload', () => {
  it('an overridden field is NOT clobbered by shared-core sync', () => {
    const bundle = aggregateCreatorBundle(rowsFor({ distributionMode: 'shared' }), { now: CTX.now })!;
    // Mark Instagram caption as a platform override.
    const igIdx = bundle.variants.findIndex((v) => v.platform_context.platform === 'instagram');
    const overridden = applyWorkspaceEdits(
      bundle.variants[igIdx]!, { caption: 'IG-ONLY CAPTION' },
      { ...CTX, asOverride: true },
    );
    bundle.variants[igIdx] = overridden;
    bundle.override_layers!.instagram = ['caption'];

    const { bundle: next, skipped_overrides } = syncSharedCoreEdits(
      bundle, { caption: 'SHARED CAPTION' }, CTX,
    );
    const ig = next.variants.find((v) => v.platform_context.platform === 'instagram')!;
    expect(ig.packaging_context.caption).toBe('IG-ONLY CAPTION'); // preserved
    expect(skipped_overrides.instagram).toContain('caption');
    // provenance survives a persist→reload round trip
    const rerows = next.variants.map((v) => ({
      content: JSON.stringify(toPersistableContent(v)),
      content_type: 'carousel', platform: v.platform_context.platform,
      asset_type: 'carousel', intent_type: 'creator', week_number: 2,
    }));
    const back = aggregateCreatorBundle(rerows, { now: CTX.now })!;
    const igBack = back.variants.find((v) => v.platform_context.platform === 'instagram')!;
    expect(igBack.workspace_meta?.override_provenance?.caption).toBeDefined();
    expect(back.override_layers?.instagram).toContain('caption');
  });
});

describe('Validation-4 — stale-edit rejection', () => {
  it('applyWorkspaceEdits throws on a stale expected revision', () => {
    const bundle = aggregateCreatorBundle(rowsFor({ distributionMode: 'shared' }), { now: CTX.now })!;
    const core = bundle.shared_core!;
    const curRev = core.workspace_meta?.workspace_revision ?? 0;
    expect(() => applyWorkspaceEdits(core, { caption: 'x' },
      { ...CTX, expectedRevision: curRev + 99 })).toThrow(StaleWorkspaceEditError);
    // correct revision succeeds
    const ok = applyWorkspaceEdits(core, { caption: 'x' },
      { ...CTX, expectedRevision: curRev });
    expect(ok.workspace_meta?.workspace_revision).toBe(curRev + 1);
  });

  it('syncSharedCoreEdits rejects a stale core revision', () => {
    const bundle = aggregateCreatorBundle(rowsFor({ distributionMode: 'shared' }), { now: CTX.now })!;
    expect(() => syncSharedCoreEdits(bundle, { caption: 'x' },
      { ...CTX, expectedRevision: 999 })).toThrow(StaleWorkspaceEditError);
  });
});

describe('Validation-8 — collaboration-safe conflict surface', () => {
  it('detectBundleConflicts reports variants whose revision moved', () => {
    const bundle = aggregateCreatorBundle(rowsFor({ distributionMode: 'shared' }), { now: CTX.now })!;
    const seen: Record<string, number> = {};
    for (const v of bundle.variants) seen[v.platform_context.platform] = v.workspace_meta?.workspace_revision ?? 0;
    // Another editor bumps instagram.
    const igIdx = bundle.variants.findIndex((v) => v.platform_context.platform === 'instagram');
    bundle.variants[igIdx] = applyWorkspaceEdits(bundle.variants[igIdx]!, { cta: 'moved' }, CTX);
    const conflicts = detectBundleConflicts(bundle, seen);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.platform).toBe('instagram');
    expect(conflicts[0]!.conflict).toBe(true);
  });
});

describe('Validation-9/10 — Text isolation + backward compatibility', () => {
  it('non-creator rows are dropped during aggregation', () => {
    const rows = rowsFor({ distributionMode: 'shared' });
    const mixed = [
      ...rows,
      { content: JSON.stringify({ intent_type: 'text', body: 'blog' }), content_type: 'article', intent_type: 'text' },
      { content: 'not-json' },
    ];
    const bundle = aggregateCreatorBundle(mixed as any, { now: CTX.now })!;
    expect(bundle.variants.length).toBe(6); // text/garbage excluded
  });

  it('single-variant card still produces a valid bundle', () => {
    const rows = rowsFor({ distributionMode: 'unique', platforms: ['LinkedIn'] });
    const bundle = aggregateCreatorBundle(rows, { now: CTX.now })!;
    expect(bundle.variants.length).toBe(1);
    expect(bundle.shared_core).toBeNull();
  });

  it('legacy rows without provenance reconstruct (empty override layer)', () => {
    const legacy = [{
      content: JSON.stringify({
        intent_type: 'creator', asset_type: 'image',
        packaging: { caption: 'old', hashtags: ['#x'], keywords: ['k'], meta_description: 'm', cta: 'go' },
        asset_payload: { visual_descriptor: { subject: 's' } },
        asset_instruction: { note: 'n' },
      }),
      content_type: 'image', platform: 'instagram', asset_type: 'image', intent_type: 'creator', week_number: 1,
    }];
    const bundle = aggregateCreatorBundle(legacy as any, { now: CTX.now })!;
    expect(bundle.variants.length).toBe(1);
    expect(bundle.override_layers?.instagram).toEqual([]);
  });
});

// ── Validation-7 — LIVE scheduler-boundary integrity ─────────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('Validation-7 — synced bundle rows pass deployed SQL', () => {
  it('every variant after sync is constraint-valid + strategy-free', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const bundle = aggregateCreatorBundle(rowsFor({ distributionMode: 'shared' }), { now: CTX.now })!;
      const { bundle: synced } = syncSharedCoreEdits(
        bundle, { caption: 'live unified', hashtags: ['#live'], cta: 'go' }, CTX,
      );
      for (const v of synced.variants) {
        const content = toPersistableContent(v);
        for (const k of ['blueprint', 'emotional_goal', 'planning_context', 'adaptation_context']) {
          expect(k in content).toBe(false); // scheduler boundary
        }
        const row = {
          intent_type: content.intent_type, asset_type: content.asset_type,
          packaging: content.packaging, asset_payload: content.asset_payload,
          asset_instruction: content.asset_instruction,
        };
        const r = await client.query(
          'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
          ['creator', String(content.asset_type), JSON.stringify(row)],
        );
        expect({ p: v.platform_context.platform, ok: r.rows[0].ok })
          .toEqual({ p: v.platform_context.platform, ok: true });
      }
    } finally {
      await client.end();
    }
  }, 30000);
});
