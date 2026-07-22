/**
 * WS-2D — Communication Query Profiles tests (Zone A2).
 *
 * Drives the six profiles through the facade over a populated in-memory intel
 * service. Verifies each profile composes existing queries and returns its
 * canonical envelope. Deterministic; read-only.
 */
import {
  createInMemoryCommunicationRegistry,
  createInMemorySemanticRootRegistry,
  createCommunicationIntelligence,
  createCommunicationQueryProfiles,
  deriveSemanticRootId,
  inertComparator,
  type CommunicationRegistry,
  type SemanticRootRegistry,
} from '../../services/intelligence/coordination';

const NOW = Date.parse('2026-07-20T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

const R1 = deriveSemanticRootId({ companyId: 'co', communicationIntent: 'promote', campaignId: 'c1', topic: 'q3 launch' });
const R2 = deriveSemanticRootId({ companyId: 'co', communicationIntent: 'promote', campaignId: 'c2', topic: 'old campaign' });

async function build() {
  const registry: CommunicationRegistry = createInMemoryCommunicationRegistry({ comparator: inertComparator });
  const roots: SemanticRootRegistry = createInMemorySemanticRootRegistry();
  // Only R1 is a registered Semantic Root ⇒ R2 records are "orphan" (unregistered root).
  await roots.register({
    companyId: 'co', id: R1, communicationIntent: 'promote', topic: 'q3 launch',
    businessObjective: 'pipeline', positioning: 'value', targetAudience: 'RevOps',
  });
  const post = await registry.register({
    companyId: 'co', communicationIntent: 'promote', topic: 'q3 launch', semanticRootId: R1,
    artifactType: 'post', generationStage: 'generated', publicationStatus: 'published',
    platform: 'linkedin', campaignId: 'c1', observedAt: iso(NOW - 5 * DAY),
  });
  const postId = post.ok ? post.value.id : '';
  const image = await registry.register({
    companyId: 'co', communicationIntent: 'promote', topic: 'q3 visual', semanticRootId: R1,
    artifactType: 'image', generationStage: 'render', publicationStatus: 'adapted',
    platform: 'linkedin', campaignId: 'c1', parentArtifactId: postId, observedAt: iso(NOW - 4 * DAY),
  });
  const imageId = image.ok ? image.value.id : '';
  // R2 in campaign c2, unregistered root, old (stale), never published.
  await registry.register({
    companyId: 'co', communicationIntent: 'promote', topic: 'old campaign', semanticRootId: R2,
    artifactType: 'post', generationStage: 'draft', publicationStatus: 'planned',
    platform: 'x', campaignId: 'c2', observedAt: iso(NOW - 200 * DAY),
  });
  // A broken-lineage record: parent points to a non-existent id.
  await registry.register({
    companyId: 'co', communicationIntent: 'promote', topic: 'ghost child', semanticRootId: R1,
    artifactType: 'image', generationStage: 'render', publicationStatus: 'adapted',
    platform: 'linkedin', campaignId: 'c1', parentArtifactId: 'ghost-id', observedAt: iso(NOW - 3 * DAY),
  });

  const intel = createCommunicationIntelligence({ registry, roots, nowMs: () => NOW });
  const profiles = createCommunicationQueryProfiles({ intel });
  return { profiles, postId, imageId };
}

describe('WS-2D — framework', () => {
  it('guards the tenant', async () => {
    const { profiles } = await build();
    const r = await profiles.timeline('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TENANT_REQUIRED');
  });

  it('wraps every response in the canonical envelope', async () => {
    const { profiles } = await build();
    const r = await profiles.analytics('co');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.meta.profileType).toBe('analytics');
      expect(r.value.meta.companyId).toBe('co');
      expect(r.value.meta.degraded).toBe(false);
    }
  });
});

describe('WS-2D — Timeline profile', () => {
  it('returns dashboard items with lifecycle progression + derived artifacts', async () => {
    const { profiles, postId, imageId } = await build();
    const r = await profiles.timeline('co', { sinceDays: 90 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const post = r.value.data.items.find((i) => i.id === postId);
    expect(post?.lifecycle.current).toBe('published');
    expect(post?.lifecycle.completed).toContain('generated');
    expect(post?.derivedArtifactIds).toContain(imageId); // image derives from post
  });
});

describe('WS-2D — Continuity profile', () => {
  it('scores continuity and flags orphan communications', async () => {
    const { profiles } = await build();
    const r = await profiles.continuity('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.value.data.continuityScore).toBe('number');
    expect(r.value.data.continuityScore).toBeGreaterThanOrEqual(0);
    expect(r.value.data.continuityScore).toBeLessThanOrEqual(1);
    // R2 records reference an unregistered root ⇒ orphan.
    expect(r.value.data.orphanCommunications.some((c) => c.semanticRootId === R2)).toBe(true);
  });
});

describe('WS-2D — Campaign profile', () => {
  it('summarizes per campaign, generic (no campaign import)', async () => {
    const { profiles } = await build();
    const r = await profiles.campaign('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c1 = r.value.data.campaigns.find((c) => c.campaignId === 'c1');
    expect(c1?.publicationCoverage.published).toBeGreaterThanOrEqual(1);
    expect(c1?.derivedAssetCount).toBeGreaterThanOrEqual(1); // the image(s)
  });
});

describe('WS-2D — Semantic profile', () => {
  it('returns lineage, descendants and a lineage tree for a root', async () => {
    const { profiles, imageId } = await build();
    const r = await profiles.semantic('co', { semanticRootId: R1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.root?.id).toBe(R1);
    expect(r.value.data.descendantIds).toContain(imageId);
    expect(r.value.data.lineageTree?.id).toBe(R1);
  });
});

describe('WS-2D — Analytics profile', () => {
  it('produces distributions and rates', async () => {
    const { profiles } = await build();
    const r = await profiles.analytics('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.totalCommunications).toBe(4);
    expect(r.value.data.platformDistribution.length).toBeGreaterThan(0);
    expect(r.value.data.semanticReuseRate).toBeGreaterThanOrEqual(0);
    expect(r.value.data.communicationVelocityPerWeek).toBeGreaterThan(0);
  });
});

describe('WS-2D — Audit profile', () => {
  it('flags missing roots, broken lineage and stale communications', async () => {
    const { profiles } = await build();
    const r = await profiles.audit('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.missingSemanticRoots).toContain(R2);
    expect(r.value.data.brokenLineage.some((b) => b.parentArtifactId === 'ghost-id')).toBe(true);
    expect(r.value.data.staleCommunications.length).toBeGreaterThan(0);
  });
});
