/**
 * Validation — Step-16 automatic pre-enqueue shared-media orchestration.
 *
 *   1  automatic inheritance finalization
 *   2  no manual trigger required (adapter auto-runs end-to-end)
 *   3  override correctness
 *   4  revert correctness
 *   5  duplicate prevention
 *   6  compatibility enforcement (fail-closed)
 *   7  scheduler-boundary integrity (content-only uploaded_media_url)
 *   8  BOLT Text isolation
 *   9  backward compatibility (flag OFF ⇒ ran:false, no writes)
 *   10 end-to-end multi-platform publish prep
 *
 * Pure orchestrator + DI runtime adapter (mock supabase/ownedDbTable —
 * no real DB, no scheduler import).
 */

import {
  prepareSharedMediaForPublishing,
  runSharedMediaPreEnqueue,
  type OrchestrationRowInput,
} from '../../services/creator/media';

const FLAG = 'ENABLE_CREATOR_WORKSPACE_LIFECYCLE';
const ATT = {
  asset_id: 'asset-1', asset_url: 'https://cdn/shared.png',
  override_policy: 'inherit_all' as const, compatibility_policy: 'registry' as const,
};
function input(over: Partial<OrchestrationRowInput> = {}): OrchestrationRowInput {
  return {
    rowKey: 'r1', intentType: 'creator', platform: 'linkedin',
    assetType: 'image', attachment: ATT, ...over,
  };
}

describe('Validation-1/3/4/5/6 — pure orchestrator semantics', () => {
  it('auto-finalizes inherited rows into content-only patches', () => {
    const r = prepareSharedMediaForPublishing([
      input({ rowKey: 'a', platform: 'linkedin' }),
      input({ rowKey: 'b', platform: 'instagram' }),
    ]);
    expect(r.patches).toHaveLength(2);
    for (const p of r.patches) {
      expect(Object.keys(p.content_patch)).toEqual(['uploaded_media_url']);
      expect(p.content_patch.uploaded_media_url).toBe('https://cdn/shared.png');
    }
    expect(r.events).toEqual(expect.arrayContaining([
      'shared_media_prepare_started', 'shared_media_prepare_completed',
    ]));
    expect(r.summary.attached).toBe(2);
  });

  it('override / revert / duplicate / incompatible all handled fail-closed', () => {
    const r = prepareSharedMediaForPublishing([
      input({ rowKey: 'rep', platform: 'instagram',
        overrides: { instagram: { kind: 'replaced', asset_id: 'ig', asset_url: 'https://cdn/ig.png' } } }),
      input({ rowKey: 'rev', platform: 'facebook' }),                                  // no override = inherited
      input({ rowKey: 'dup', platform: 'linkedin', existingUploadedUrl: 'https://cdn/shared.png' }),
      input({ rowKey: 'inc', platform: 'linkedin', assetType: 'reel' }),               // incompatible
    ]);
    const byKey = Object.fromEntries(r.patches.map((p) => [p.rowKey, p.content_patch.uploaded_media_url]));
    expect(byKey.rep).toBe('https://cdn/ig.png');           // override
    expect(byKey.rev).toBe('https://cdn/shared.png');       // revert→inherited
    expect('dup' in byKey).toBe(false);                     // duplicate prevented (no patch)
    expect('inc' in byKey).toBe(false);                     // incompatible skipped
    expect(r.summary).toEqual(expect.objectContaining({ attached: 2, reused: 1, incompatible: 1 }));
    expect(r.events).toEqual(expect.arrayContaining([
      'duplicate_media_prevented', 'incompatible_media_skipped',
    ]));
  });

  it('a per-row failure is isolated; batch never throws or partially corrupts', () => {
    // attachment:null → finalize returns no_attachment skip (not a throw),
    // proving isolation + that good rows still produce patches.
    const r = prepareSharedMediaForPublishing([
      input({ rowKey: 'ok' }),
      { rowKey: 'bad', intentType: 'creator', platform: 'x', assetType: 'image', attachment: null },
    ]);
    expect(r.patches.map((p) => p.rowKey)).toEqual(['ok']);
    expect(r.summary.total).toBe(2);
  });

  it('empty input ⇒ skipped (no work, no events noise)', () => {
    const r = prepareSharedMediaForPublishing([]);
    expect(r.patches).toEqual([]);
    expect(r.events).toEqual(['shared_media_prepare_skipped']);
  });
});

describe('Validation-8 — BOLT Text isolation', () => {
  it('text rows never produce a media patch', () => {
    const r = prepareSharedMediaForPublishing([
      input({ rowKey: 't', intentType: 'text' }),
      input({ rowKey: 'c', intentType: 'creator' }),
    ]);
    expect(r.patches.map((p) => p.rowKey)).toEqual(['c']);
    for (const p of r.patches) {
      for (const k of ['caption', 'hashtags', 'cta', 'meta_description']) {
        expect(k in p.content_patch).toBe(false);
      }
    }
  });
});

/* ── DI runtime adapter (mock supabase / ownedDbTable) ──────────────────── */
function makeDeps(rows: any[], attachment: any, overrides: any[], coreAssetUrl: string | null) {
  const writes: any[] = [];
  const builder = (table: string) => {
    const state: any = { table, filters: {} as Record<string, string> };
    const api: any = {
      select: () => api,
      eq: (k: string, v: string) => { state.filters[k] = v; return api; },
      limit: () => api,
      maybeSingle: async () => {
        if (table === 'content_asset_attachment') return { data: attachment };
        if (table === 'content_core_asset') return { data: coreAssetUrl == null ? null : { asset_url: coreAssetUrl } };
        return { data: null };
      },
      then: undefined,
    };
    // overrides query resolves via awaited select().eq()
    if (table === 'content_asset_platform_override') {
      api.select = () => ({ eq: async () => ({ data: overrides }) });
    }
    if (table === 'daily_content_plans') {
      api.select = () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: rows }) }) }) });
      api.update = (patch: any) => ({ eq: () => ({ eq: async () => { writes.push(patch); return { error: null }; } }) });
    }
    return api;
  };
  return { supabase: { from: builder }, ownedDbTable: builder, writes };
}

describe('Validation-2/7/9/10 — automatic adapter (no manual trigger)', () => {
  const O = process.env[FLAG];
  afterEach(() => { if (O === undefined) delete process.env[FLAG]; else process.env[FLAG] = O; });

  const sibRows = [
    { id: 'row-li', content: JSON.stringify({ platform: 'linkedin', creator_planning_source: { card_id: 'core-1' } }), content_type: 'image', platform: 'linkedin', intent_type: 'creator' },
    { id: 'row-ig', content: JSON.stringify({ platform: 'instagram', creator_planning_source: { card_id: 'core-1' } }), content_type: 'image', platform: 'instagram', intent_type: 'creator' },
    { id: 'row-x',  content: JSON.stringify({ platform: 'x', creator_planning_source: { card_id: 'core-1' } }), content_type: 'image', platform: 'x', intent_type: 'creator' },
  ];

  it('flag OFF ⇒ ran:false, zero writes (backward compatible)', async () => {
    delete process.env[FLAG];
    const d = makeDeps(sibRows, { id: 'att1', asset_id: 'asset-1', override_policy: 'inherit_all', compatibility_policy: 'registry' }, [], 'https://cdn/shared.png');
    const r = await runSharedMediaPreEnqueue(d, { campaignId: 'camp-1' });
    expect(r.ran).toBe(false);
    expect(d.writes).toHaveLength(0);
  });

  it('flag ON ⇒ auto end-to-end, content-only writes, scheduler-safe', async () => {
    process.env[FLAG] = '1';
    const d = makeDeps(
      sibRows,
      { id: 'att1', asset_id: 'asset-1', override_policy: 'inherit_all', compatibility_policy: 'registry' },
      [{ platform: 'instagram', override_kind: 'disabled', override_asset_id: null, override_asset_url: null }],
      'https://cdn/shared.png',
    );
    const r = await runSharedMediaPreEnqueue(d, { campaignId: 'camp-1' });
    expect(r.ran).toBe(true);
    // li + x inherit; ig disabled (still a content patch → null); all content-only
    expect(d.writes.length).toBeGreaterThanOrEqual(2);
    for (const w of d.writes) {
      const c = JSON.parse(w.content);
      expect('uploaded_media_url' in c).toBe(true);
      expect('caption' in c).toBe(false);          // Text never touched
      expect('scheduler_row' in c).toBe(false);    // scheduler-boundary intact
    }
    expect(r.summary.total).toBeGreaterThan(0);
  });

  it('adapter is hard fail-closed (throwing deps ⇒ ran:false, no throw)', async () => {
    process.env[FLAG] = '1';
    const boom: any = { from: () => { throw new Error('db down'); } };
    const r = await runSharedMediaPreEnqueue({ supabase: boom, ownedDbTable: boom }, { campaignId: 'camp-1' });
    expect(r.ran).toBe(false);
    expect(r.events).toContain('shared_media_prepare_failed');
  });
});
