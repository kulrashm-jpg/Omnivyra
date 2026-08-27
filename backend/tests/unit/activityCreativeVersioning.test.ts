/**
 * Phase 64B-C — a refinement is a new version, never a replacement.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The creative a campaign generated is what a person reviewed and may already
 * have scheduled. Refining it must therefore ADD, not overwrite: if a
 * refinement could rewrite version 1, a user experimenting on a Tuesday would
 * silently change what publishes on Friday, and the thing they approved would
 * be gone with no way back.
 *
 * So the guarantees pinned here are:
 *
 *   the original stays version 1, readable, forever
 *   each refinement appends and moves currentVersion forward
 *   a FAILED refinement changes nothing at all
 *   references are resolved by the orchestrator, never re-interpreted here
 *
 * The last one matters as much as the rest: the moment this service started
 * deciding what a reference means, there would be two answers in the codebase.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const rows: Record<string, unknown[]> = { daily_content_plans: [], campaigns: [] };
let envelope: Record<string, unknown> | null = null;
let written: Record<string, unknown>[] = [];
const orchestrate = jest.fn();

function builderFor(table: string) {
  const filters: Array<[string, unknown]> = [];
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    maybeSingle: async () => ({
      data: (rows[table] ?? []).find((r) =>
        filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)) ?? null,
      error: null,
    }),
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builderFor(t) }));
jest.mock('../../services/creatorAssetPersistenceService', () => ({
  libraryReadAsset: async () => (envelope ? { library: envelope } : null),
  libraryWriteAsset: async (input: { envelope: Record<string, unknown> }) => {
    written.push(input.envelope);
    envelope = input.envelope;
    return { id: 'asset-1' };
  },
}));
jest.mock('../../services/creator/creatorOrchestrator', () => ({
  runCreatorOrchestration: (...a: unknown[]) => orchestrate(...a),
}));

import { refineActivityCreative } from '../../services/creator/activityCreativeRefinementService';

const ORIGINAL_PAYLOAD = { title: 'Campaign original', url: 'https://cdn/original.png' };

beforeEach(() => {
  rows.campaigns = [{ id: 'camp-A', company_id: 'co-A' }, { id: 'camp-B', company_id: 'co-B' }];
  rows.daily_content_plans = [
    {
      id: 'act-A', campaign_id: 'camp-A', asset_type: 'image', content_status: 'render_ready',
      content: JSON.stringify({
        title: 'Launch week', platform: 'linkedin',
        creator_asset_id: 'asset-1',
        rendered_asset: { creator_asset_id: 'asset-1', urls: ['https://cdn/original.png'] },
      }),
    },
    {
      id: 'act-B', campaign_id: 'camp-B', asset_type: 'image', content_status: 'render_ready',
      content: JSON.stringify({
        creator_asset_id: 'asset-B',
        rendered_asset: { creator_asset_id: 'asset-B', urls: ['https://cdn/b.png'] },
      }),
    },
  ];
  envelope = {
    id: 'asset-1',
    currentVersion: 1,
    versions: [{ version: 1, op: 'generate', payload: ORIGINAL_PAYLOAD, createdAt: '2026-01-01' }],
  };
  written = [];
  orchestrate.mockReset().mockResolvedValue({
    output: {
      asset_payload: { title: 'Refined', url: 'https://cdn/refined.png' },
      metadata: { rendered_asset: { urls: ['https://cdn/refined.png'] } },
    },
  });
});

/* ── A. The original survives ───────────────────────────────────────────────*/

describe('A — refinement appends; the campaign original is untouched', () => {
  it('CRITICAL: version 1 still holds the original payload afterwards', async () => {
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.ok).toBe(true);
    const versions = envelope!.versions as Record<string, unknown>[];
    const v1 = versions.find((v) => v.version === 1)!;
    expect(v1.op).toBe('generate');
    expect(v1.payload).toEqual(ORIGINAL_PAYLOAD);
  });

  it('CRITICAL: the refinement is a DISTINCT new version', async () => {
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.version).toBe(2);
    expect(out.originalVersion).toBe(1);
    const versions = envelope!.versions as Record<string, unknown>[];
    expect(versions).toHaveLength(2);
    expect(versions[1].op).toBe('version');
    expect(versions[1].payload).not.toEqual(ORIGINAL_PAYLOAD);
  });

  it('CRITICAL: currentVersion moves forward, so the workspace can tell them apart', async () => {
    await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(envelope!.currentVersion).toBe(2);
  });

  it('the asset identity never changes — it is the same asset, refined', async () => {
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.creatorAssetId).toBe('asset-1');
    expect(envelope!.id).toBe('asset-1');
  });

  it('the refinement records which activity it came from', async () => {
    await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    const v2 = (envelope!.versions as Record<string, unknown>[])[1];
    const payload = v2.payload as Record<string, unknown>;
    expect(payload.refinedFromActivityId).toBe('act-A');
    expect(payload.compositionId).toBe('act-A');
  });
});

/* ── B. Multiple refinements ────────────────────────────────────────────────*/

describe('B — refine again, and again', () => {
  it('CRITICAL: three refinements produce versions 2, 3, 4 with v1 intact', async () => {
    const a = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    const b = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    const c = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect([a.version, b.version, c.version]).toEqual([2, 3, 4]);
    expect(envelope!.currentVersion).toBe(4);
    const versions = envelope!.versions as Record<string, unknown>[];
    expect(versions).toHaveLength(4);
    expect(versions[0].payload).toEqual(ORIGINAL_PAYLOAD);
    expect(versions[0].op).toBe('generate');
  });

  it('the version number is derived from the history, not from a counter', async () => {
    // A gap in the history (a restore, a manual edit) must not produce a
    // duplicate version number.
    envelope!.versions = [
      { version: 1, op: 'generate', payload: ORIGINAL_PAYLOAD },
      { version: 7, op: 'version', payload: {} },
    ];
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.version).toBe(8);
  });

  it('CRITICAL: each refinement reuses ONE composition — no duplicate reference rows', async () => {
    await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    const compositionIds = orchestrate.mock.calls.map((c) => (c[0] as Record<string, unknown>).compositionId);
    expect(compositionIds).toEqual(['act-A', 'act-A']);
    // This service never writes references itself — it cannot duplicate them.
    const src = require('fs').readFileSync(require('path').resolve(
      __dirname, '../../services/creator/activityCreativeRefinementService.ts'), 'utf8');
    expect(src).not.toContain('composition_asset_references');
    expect(src).not.toContain('attachCreatorCompositionAsset');
  });
});

/* ── C. Failure changes nothing ─────────────────────────────────────────────*/

describe('C — a failed refinement costs the user nothing', () => {
  it('CRITICAL: a render throw leaves the envelope exactly as it was', async () => {
    orchestrate.mockRejectedValue(new Error('provider exploded'));
    const before = JSON.stringify(envelope);
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('render_failed');
    expect(JSON.stringify(envelope)).toBe(before);
    expect(written).toHaveLength(0);
  });

  it('CRITICAL: an empty render result is a failure, not a blank version', async () => {
    orchestrate.mockResolvedValue({ output: {} });
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('render_failed');
    expect(envelope!.currentVersion).toBe(1);
    expect(written).toHaveLength(0);
  });

  it('CRITICAL: a render that cannot be recorded is reported, not claimed', async () => {
    envelope = null; // no envelope to append to
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('asset_unavailable');
  });

  it('an activity with no creative yet is refused before anything renders', async () => {
    rows.daily_content_plans.push({
      id: 'act-new', campaign_id: 'camp-A', asset_type: 'image', content: '{}',
    });
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-new' });
    expect(out.reason).toBe('not_refinable');
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('a failure never reports a version number', async () => {
    orchestrate.mockRejectedValue(new Error('x'));
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect(out.version).toBeNull();
    expect(out.urls).toEqual([]);
  });
});

/* ── D. Tenancy holds through the render ────────────────────────────────────*/

describe('D — the company boundary survives refinement', () => {
  it('CRITICAL: tenant A cannot refine tenant B activity', async () => {
    const out = await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-B' });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('activity_not_found');
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('CRITICAL: the render is told the authenticated company, never a supplied one', async () => {
    await refineActivityCreative({ companyId: 'co-A', userId: 'u1', activityId: 'act-A' });
    expect((orchestrate.mock.calls[0][0] as Record<string, unknown>).companyId).toBe('co-A');
  });

  it('missing identity refuses before any lookup', async () => {
    for (const [companyId, activityId] of [['', 'act-A'], ['co-A', '']]) {
      const out = await refineActivityCreative({ companyId, userId: 'u1', activityId });
      expect(out.ok).toBe(false);
    }
    expect(orchestrate).not.toHaveBeenCalled();
  });
});

/* ── E. It reuses; it does not re-implement ─────────────────────────────────*/

describe('E — one renderer, one resolver, one version model', () => {
  const src = require('fs').readFileSync(require('path').resolve(
    __dirname, '../../services/creator/activityCreativeRefinementService.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('CRITICAL: rendering goes through the canonical orchestration entry', () => {
    expect(src).toContain('runCreatorOrchestration');
    expect(src).not.toContain('renderAsset(');
    expect(src).not.toContain('generateProviderImage');
    expect(src).not.toContain('images.edit');
  });

  it('CRITICAL: references are resolved by the orchestrator, not here', () => {
    expect(src).toContain('compositionId: creative.compositionId');
    expect(src).not.toContain('resolveCompositionReferencesForRender');
    expect(src).not.toContain('slotAcceptance');
    expect(src).not.toContain('proposeImageTreatment');
  });

  it('CRITICAL: versioning uses the existing envelope, not a new table', () => {
    expect(src).toContain('libraryReadAsset');
    expect(src).toContain('libraryWriteAsset');
    expect(src).toContain("op: 'version'");
    expect(src).not.toMatch(/from\('creator_asset_versions'\)|creator_versions/);
  });

  it('no storage reader and no URL minting', () => {
    for (const bad of ['readCanonicalAssetBytes', 'storage.from', 'getPublicUrl', 'createSignedUrl']) {
      expect(src).not.toContain(bad);
    }
  });

  it('the stock-image path is not referenced at all', () => {
    expect(src).not.toMatch(/ImagePicker|attribution|imageByScheduleId/i);
  });

  it('campaign creation, scheduling and Strategic Mix are untouched by it', () => {
    for (const bad of ['strategicMix', 'StrategicMix', 'scheduled_posts', 'campaignVariantFanOut']) {
      expect(src).not.toContain(bad);
    }
  });
});

/* ── F. The loop the user actually touches ──────────────────────────────────*/

describe('F — route and panel keep the same promises', () => {
  const read = (rel: string) => require('fs').readFileSync(
    require('path').resolve(__dirname, '../../..', rel), 'utf8');
  const ROUTE = read('pages/api/activity-workspace/refine-creative.ts');
  const PANEL = read('components/activity-workspace/ActivityCreativeRefinementPanel.tsx');

  it('CRITICAL: the route accepts NO references from the caller', () => {
    // References come from the composition, never from the request body, so a
    // caller cannot smuggle one past routing/tenancy/lifecycle.
    for (const bad of ['purpose', 'asset_id', 'media_file_id', 'references']) {
      expect(ROUTE).not.toContain(`body?.${bad}`);
    }
    expect(ROUTE).toMatch(/body\?\.company_id/);
    expect(ROUTE).toMatch(/body\?\.activity_id/);
  });

  it('CRITICAL: the route uses the workspace access gate', () => {
    expect(ROUTE).toContain('enforceCompanyAccess');
    expect(ROUTE).toContain('isContentArchitectSession');
  });

  it('CRITICAL: a foreign activity is 404; a real failure is 422', () => {
    expect(ROUTE).toMatch(/result\.reason === 'activity_not_found' \? 404 : 422/);
    expect(ROUTE).not.toContain('status(403)');
  });

  it('CRITICAL: every failure states the original is preserved', () => {
    expect(ROUTE).toContain('original_preserved: true');
    expect(ROUTE).toMatch(/Your original is unchanged/);
  });

  it('CRITICAL: the panel never claims success on failure', () => {
    expect(PANEL).toMatch(/if \(!res\.ok \|\| !data\) \{[\s\S]{0,200}setError/);
    expect(PANEL).toContain('setRefined(null)');
  });

  it('CRITICAL: the refined result names BOTH versions', () => {
    expect(PANEL).toContain('Refined version {refined.version} is now current.');
    expect(PANEL).toContain('is the original from your campaign, still saved');
  });

  it('CRITICAL: the panel sends no references either', () => {
    expect(PANEL).toContain("body: JSON.stringify({ company_id: companyId, activity_id: activityId })");
  });

  it('the stock-image control is still nowhere near this panel', () => {
    for (const bad of ['ImagePicker', 'attribution', 'imageByScheduleId']) {
      expect(PANEL).not.toContain(bad);
    }
  });
});
