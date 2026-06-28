import {
  canTransition, buildWorkspaceAssets, buildWorkspaceState, setAssetStatus,
  statusCounts, assetsByStatus, publishCenterAssets, ASSET_STATUS_LABELS, type AssetStatus,
} from '../../../lib/content/creationGenerationState';
import { buildCreationPlan, emptyMarketingBrief } from '../../../lib/content/unifiedCreationModel';

const plan = buildCreationPlan('launch-product', emptyMarketingBrief('launch-product'))!;

describe('CREATOR-059 — Shared creation generation state', () => {
  it('STEP 4 — builds workspace assets from a plan; one shared status per asset', () => {
    const assets = buildWorkspaceAssets(plan);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((a) => a.status === 'planned')).toBe(true);
    expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);       // unique
    for (const a of assets) { expect(['writer', 'creator', 'campaign']).toContain(a.lane); expect(ASSET_STATUS_LABELS[a.status]).toBeTruthy(); }
  });

  it('enforces valid lifecycle transitions only', () => {
    expect(canTransition('planned', 'queued')).toBe(true);
    expect(canTransition('queued', 'generating')).toBe(true);
    expect(canTransition('generating', 'needs-review')).toBe(true);
    expect(canTransition('needs-review', 'approved')).toBe(true);
    expect(canTransition('approved', 'published')).toBe(true);
    expect(canTransition('failed', 'queued')).toBe(true);             // retry
    expect(canTransition('needs-review', 'generating')).toBe(true);   // regenerate
    // Invalid jumps rejected.
    expect(canTransition('planned', 'published')).toBe(false);
    expect(canTransition('published', 'generating')).toBe(false);
    expect(canTransition('queued', 'approved')).toBe(false);
  });

  it('setAssetStatus applies valid transitions and ignores invalid ones (immutably)', () => {
    const s0 = buildWorkspaceState(plan);
    const id = s0.assets[0].id;
    const s1 = setAssetStatus(s0, id, 'queued');
    expect(s1).not.toBe(s0);
    expect(s1.assets.find((a) => a.id === id)!.status).toBe('queued');
    // Invalid transition → same reference, unchanged.
    const s2 = setAssetStatus(s1, id, 'published');
    expect(s2).toBe(s1);
    expect(s2.assets.find((a) => a.id === id)!.status).toBe('queued');
    // Unknown asset → no-op.
    expect(setAssetStatus(s0, 'nope', 'queued')).toBe(s0);
  });

  it('STEP 5 — publish center + counts reflect shared state across lanes', () => {
    let s = buildWorkspaceState(plan);
    const ids = s.assets.slice(0, 1).map((a) => a.id);
    for (const id of ids) for (const step of ['queued', 'generating', 'needs-review', 'approved'] as AssetStatus[]) s = setAssetStatus(s, id, step);
    const counts = statusCounts(s);
    expect(counts.approved).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(s.assets.length);
    expect(assetsByStatus(s, 'approved').length).toBe(1);
    expect(publishCenterAssets(s).some((a) => a.status === 'approved')).toBe(true);
  });
});
