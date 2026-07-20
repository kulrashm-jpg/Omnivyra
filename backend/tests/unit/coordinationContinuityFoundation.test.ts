/**
 * Semantic Continuity Foundation tests (OMNI-COORD-002, Zone A2).
 *
 * Covers the Semantic Root registry, lineage round-trip, the pure communication
 * graph projection, the inert (no-AI) continuity/drift evaluators, and the
 * platform facade. All deterministic, in-memory; no seam, no DB, no AI.
 */
import {
  createInMemorySemanticRootRegistry,
  createInMemoryCommunicationRegistry,
  createSemanticCoordinationPlatform,
  buildCommunicationGraph,
  nodeKindForArtifact,
  inertContinuityEvaluator,
  inertDriftEvaluator,
  inertComparator,
  type CommunicationRecord,
  type SemanticRoot,
  type RegisterCommunicationInput,
} from '../../services/intelligence/coordination';

const fixedNow = () => '2026-07-20T00:00:00.000Z';

const rootInput = {
  companyId: 'company-A',
  businessObjective: 'grow qualified pipeline',
  campaignObjective: 'Q3 pricing launch',
  topic: 'new pricing tiers',
  communicationIntent: 'promote' as const,
  targetAudience: 'RevOps leaders',
  positioning: 'transparent value-based pricing',
};

describe('OMNI-COORD-002 — SemanticRootRegistry', () => {
  it('registers, gets, and lists roots (tenant-scoped, deterministic id)', async () => {
    const reg = createInMemorySemanticRootRegistry({ now: fixedNow });
    const r = await reg.register(rootInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toMatch(/^sroot_/);
    expect(r.value.positioning).toBe('transparent value-based pricing');
    expect(r.value.createdAt).toBe('2026-07-20T00:00:00.000Z');

    const got = await reg.get('company-A', r.value.id);
    expect(got.ok && got.value?.id).toBe(r.value.id);

    const list = await reg.list('company-A');
    expect(list.ok && list.value).toHaveLength(1);
  });

  it('requires a tenant', async () => {
    const reg = createInMemorySemanticRootRegistry();
    const r = await reg.register({ ...rootInput, companyId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TENANT_REQUIRED');
  });
});

describe('OMNI-COORD-002 — lineage round-trip through the communication registry', () => {
  it('preserves optional lineage metadata on register/lookup', async () => {
    const reg = createInMemoryCommunicationRegistry({ comparator: inertComparator, now: fixedNow });
    const input: RegisterCommunicationInput = {
      companyId: 'company-A',
      communicationIntent: 'promote',
      topic: 'pricing announcement post',
      artifactType: 'post',
      parentArtifactId: 'brief-1',
      derivedFrom: ['brief-1'],
      generationStage: 'draft',
    };
    const r = await reg.register(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.artifactType).toBe('post');
    expect(r.value.parentArtifactId).toBe('brief-1');
    expect(r.value.generationStage).toBe('draft');

    const list = await reg.lookup('company-A');
    if (list.ok) expect(list.value[0].derivedFrom).toEqual(['brief-1']);
  });
});

describe('OMNI-COORD-002 — communication graph projection (pure)', () => {
  const root: SemanticRoot = {
    id: 'sroot_1', companyId: 'company-A', businessObjective: 'x', topic: 'pricing',
    communicationIntent: 'promote', targetAudience: 'a', positioning: 'p', createdAt: fixedNow(),
  };
  const artifact = (id: string, over: Partial<CommunicationRecord>): CommunicationRecord => ({
    id, companyId: 'company-A', semanticRootId: 'sroot_1', communicationIntent: 'promote',
    topic: id, publicationStatus: 'planned', sourceModule: 'campaigns', observedAt: fixedNow(), ...over,
  });

  it('maps artifact types to node kinds', () => {
    expect(nodeKindForArtifact('post')).toBe('content');
    expect(nodeKindForArtifact('image')).toBe('visual');
    expect(nodeKindForArtifact('engagement')).toBe('engagement');
    expect(nodeKindForArtifact('analytics')).toBe('analytics');
    expect(nodeKindForArtifact('semantic_root')).toBe('semantic_root');
  });

  it('projects a full lineage chain with typed edges', () => {
    const artifacts = [
      artifact('brief', { artifactType: 'content_brief', generationStage: 'brief', parentArtifactId: null }),
      artifact('post', { artifactType: 'post', generationStage: 'draft', parentArtifactId: 'brief' }),
      artifact('adapt', { artifactType: 'platform_adaptation', generationStage: 'adaptation', parentArtifactId: 'post', platform: 'linkedin' }),
      artifact('pub', { artifactType: 'published_asset', generationStage: 'publication', parentArtifactId: 'adapt' }),
      artifact('eng', { artifactType: 'engagement', generationStage: 'engagement', parentArtifactId: 'pub' }),
      artifact('ana', { artifactType: 'analytics', generationStage: 'measurement', parentArtifactId: 'pub' }),
    ];
    const g = buildCommunicationGraph({ companyId: 'company-A', roots: [root], artifacts });

    // root + 6 artifacts
    expect(g.nodes.find((n) => n.id === 'sroot_1')?.kind).toBe('semantic_root');
    expect(g.nodes).toHaveLength(7);

    const has = (from: string, to: string, kind: string) => g.edges.some((e) => e.from === from && e.to === to && e.kind === kind);
    expect(has('brief', 'sroot_1', 'belongs_to')).toBe(true);
    expect(has('brief', 'sroot_1', 'derives_from')).toBe(true); // no parent ⇒ derives from root
    expect(has('post', 'brief', 'derives_from')).toBe(true);
    expect(has('adapt', 'post', 'adapts')).toBe(true);
    expect(has('eng', 'pub', 'responds_to')).toBe(true);
    expect(has('ana', 'pub', 'measures')).toBe(true);
  });

  it('scopes the projection to a single root when requested', () => {
    const other: SemanticRoot = { ...root, id: 'sroot_2' };
    const artifacts = [
      artifact('a1', { semanticRootId: 'sroot_1', artifactType: 'post' }),
      artifact('a2', { semanticRootId: 'sroot_2', artifactType: 'post' }),
    ];
    const g = buildCommunicationGraph({ companyId: 'company-A', roots: [root, other], artifacts, semanticRootId: 'sroot_1' });
    expect(g.nodes.some((n) => n.id === 'a2')).toBe(false);
    expect(g.nodes.some((n) => n.id === 'a1')).toBe(true);
  });
});

describe('OMNI-COORD-002 — inert evaluators (contract-only, no AI)', () => {
  const root: SemanticRoot = {
    id: 'sroot_1', companyId: 'c', businessObjective: 'x', topic: 't',
    communicationIntent: 'promote', targetAudience: 'a', positioning: 'p', createdAt: fixedNow(),
  };
  const artifact: CommunicationRecord = {
    id: 'pub', companyId: 'c', semanticRootId: 'sroot_1', communicationIntent: 'promote',
    topic: 't', publicationStatus: 'published', sourceModule: 'writer', observedAt: fixedNow(),
  };

  it('continuity evaluator returns NOT_EVALUABLE', async () => {
    const v = await inertContinuityEvaluator.evaluate({ root, artifact });
    expect(v.decision).toBe('NOT_EVALUABLE');
    expect(v.basis).toBe('none');
    expect(v.score).toBeNull();
  });

  it('drift evaluator returns not_evaluable', async () => {
    const d = await inertDriftEvaluator.assess({ root, published: artifact });
    expect(d.severity).toBe('not_evaluable');
    expect(d.drift).toBeNull();
  });
});

describe('OMNI-COORD-002 — SemanticCoordinationPlatform facade', () => {
  it('composes registries + graph projection end-to-end (in-memory)', async () => {
    const platform = createSemanticCoordinationPlatform({
      roots: createInMemorySemanticRootRegistry({ now: fixedNow }),
      communications: createInMemoryCommunicationRegistry({ comparator: inertComparator, now: fixedNow }),
    });
    const root = await platform.roots.register(rootInput);
    expect(root.ok).toBe(true);
    if (!root.ok) return;

    await platform.communications.register({
      companyId: 'company-A', communicationIntent: 'promote', topic: 'post',
      semanticRootId: root.value.id, artifactType: 'post', generationStage: 'draft',
    });

    const graph = await platform.getGraph('company-A', root.value.id);
    expect(graph.ok).toBe(true);
    if (graph.ok) {
      expect(graph.value.nodes.some((n) => n.kind === 'semantic_root')).toBe(true);
      expect(graph.value.nodes.some((n) => n.kind === 'content')).toBe(true);
    }

    // Evaluators are inert by default.
    expect(platform.continuity).toBe(inertContinuityEvaluator);
    expect(platform.drift).toBe(inertDriftEvaluator);
  });
});
