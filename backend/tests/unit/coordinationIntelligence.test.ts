/**
 * WS-2C — Communication Lifecycle Intelligence (read-side) tests (Zone A2).
 *
 * Populates an in-memory registry with a small lineage under two semantic roots,
 * then exercises every query service + graph navigation. Deterministic clock.
 */
import {
  createInMemoryCommunicationRegistry,
  createInMemorySemanticRootRegistry,
  createCommunicationIntelligence,
  deriveSemanticRootId,
  inertComparator,
  childrenOf,
  descendantsOf,
  ancestorsOf,
  type CommunicationRegistry,
  type SemanticRootRegistry,
} from '../../services/intelligence/coordination';

const NOW = Date.parse('2026-07-20T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

// Real derived roots (what a producer / duplicate-check would compute).
const R1 = deriveSemanticRootId({ companyId: 'co', communicationIntent: 'promote', campaignId: 'c1', topic: 'q3 launch' });
const R2 = deriveSemanticRootId({ companyId: 'co', communicationIntent: 'promote', campaignId: 'c2', topic: 'old campaign' });

async function seed(): Promise<{ registry: CommunicationRegistry; roots: SemanticRootRegistry; postId: string; imageId: string }> {
  const registry = createInMemoryCommunicationRegistry({ comparator: inertComparator });
  const roots = createInMemorySemanticRootRegistry();
  await roots.register({
    companyId: 'co', id: R1, communicationIntent: 'promote', topic: 'q3 launch',
    businessObjective: 'pipeline', positioning: 'value', targetAudience: 'RevOps',
  });

  // Root R1: post (published) → image (adapted, INHERITS R1 as a Creator visual would). Campaign c1.
  const post = await registry.register({
    companyId: 'co', communicationIntent: 'promote', topic: 'q3 launch', semanticRootId: R1,
    artifactType: 'post', generationStage: 'generated', publicationStatus: 'published',
    platform: 'linkedin', campaignId: 'c1', observedAt: iso(NOW - 5 * DAY),
  });
  const postId = post.ok ? post.value.id : '';
  const image = await registry.register({
    companyId: 'co', communicationIntent: 'promote', topic: 'q3 launch visual', semanticRootId: R1,
    artifactType: 'image', generationStage: 'render', publicationStatus: 'adapted',
    platform: 'linkedin', campaignId: 'c1', parentArtifactId: postId, observedAt: iso(NOW - 4 * DAY),
  });
  const imageId = image.ok ? image.value.id : '';

  // Root R2: a promote reused in a DIFFERENT campaign c2, never published, old (stale).
  await registry.register({
    companyId: 'co', communicationIntent: 'promote', topic: 'old campaign', semanticRootId: R2,
    artifactType: 'post', generationStage: 'draft', publicationStatus: 'planned',
    platform: 'x', campaignId: 'c2', observedAt: iso(NOW - 200 * DAY),
  });

  return { registry, roots, postId, imageId };
}

function makeIntel(registry: CommunicationRegistry, roots: SemanticRootRegistry) {
  return createCommunicationIntelligence({ registry, roots, nowMs: () => NOW });
}

describe('WS-2C — timeline & history', () => {
  it('returns only the last 90 days in the timeline', async () => {
    const { registry, roots } = await seed();
    const intel = makeIntel(registry, roots);
    const r = await intel.getTimeline('co');   // default 90 days
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.total).toBe(2);              // the 200-day-old R2 record excluded
    expect(r.value.entries.every((e) => e.semanticRootId === R1)).toBe(true);
  });

  it('filters history by campaign', async () => {
    const { registry, roots } = await seed();
    const intel = makeIntel(registry, roots);
    const r = await intel.getHistory('co', { campaignId: 'c2' });
    expect(r.ok && r.value.length).toBe(1);
  });

  it('requires a tenant', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getTimeline('');
    expect(r.ok).toBe(false);
  });
});

describe('WS-2C — lineage & graph traversal', () => {
  it('returns every artifact derived from a semantic root + a scoped graph', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getLineage('co', R1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.artifacts).toHaveLength(2);
    expect(r.value.root?.id).toBe(R1);
    expect(r.value.graph.nodes.some((n) => n.kind === 'semantic_root')).toBe(true);
  });

  it('navigates the graph (children / descendants / ancestors)', async () => {
    const { registry, roots, postId, imageId } = await seed();
    const g = await makeIntel(registry, roots).getGraph('co', R1);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    // image derives from post ⇒ post has child image; image has ancestor post.
    expect(childrenOf(g.value, postId).some((n) => n.id === imageId)).toBe(true);
    expect(ancestorsOf(g.value, imageId).some((n) => n.id === postId)).toBe(true);
    expect(descendantsOf(g.value, R1).length).toBeGreaterThan(0);
  });

  it('returns only published assets from a root', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getPublishedFromRoot('co', R1);
    expect(r.ok && r.value.length).toBe(1);
    if (r.ok) expect(r.value[0].publicationStatus).toBe('published');
  });
});

describe('WS-2C — lifecycle history', () => {
  it('derives completed/pending from the monotonic lifecycle', async () => {
    const { registry, roots, postId } = await seed();
    const r = await makeIntel(registry, roots).getLifecycleHistory('co', postId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.current).toBe('published');
    expect(r.value.completed).toEqual(['planned', 'generated', 'adapted', 'published']);
    expect(r.value.pending).toEqual(['engaged', 'measured', 'archived']);
  });
});

describe('WS-2C — intent reuse, clusters, repeats, gaps, continuity', () => {
  it('shows campaigns that reused the same communication intent', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getIntentReuse('co', 'promote');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const promote = r.value.find((x) => x.communicationIntent === 'promote');
    expect(promote?.campaignIds.sort()).toEqual(['c1', 'c2']);
  });

  it('clusters by semantic root (largest first)', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getSemanticClusters('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0].semanticRootId).toBe(R1);
    expect(r.value[0].size).toBe(2);
  });

  it('reports repeated intents (a root communicated more than once)', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getRepeatedIntents('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.some((x) => x.semanticRootId === R1 && x.count === 2)).toBe(true);
  });

  it('detects gaps (unpublished + stale root)', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getGaps('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kinds = r.value.filter((g) => g.semanticRootId === R2).map((g) => g.kind);
    expect(kinds).toContain('unpublished');
    expect(kinds).toContain('stale');
  });

  it('produces a continuity report', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).getContinuityReport('co');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalCommunications).toBe(3);
    expect(r.value.clusterCount).toBe(2);
    expect(r.value.gaps.length).toBeGreaterThan(0);
  });

  it('finds related communications via duplicate-intent (root match)', async () => {
    const { registry, roots } = await seed();
    const r = await makeIntel(registry, roots).findRelatedCommunications('co', {
      communicationIntent: 'promote', topic: 'q3 launch', campaignId: 'c1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.decision).toBe('duplicate_intent');
  });
});
