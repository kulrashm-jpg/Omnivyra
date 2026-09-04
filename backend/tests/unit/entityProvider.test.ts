import {
  entityEvidenceAdapter, ENTITY_EVIDENCE_KEYS, type EntityEvidenceInput,
} from '../../services/evidencePlatform/providers/entity/entityEvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';
import {
  isEntityProviderConfigured, registerEntityProvider, isEntityProviderAvailable,
  entityProviderReliability, consolidateEntityProviders, fetchEntityEvidence,
  type EntityProviderPayload,
} from '../../services/entityGraphProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';

const OBSERVED = '2026-01-31T00:00:00.000Z';

const input: EntityEvidenceInput = {
  subjectId: 'Acme Corp',
  knowledgeGraphPresence: 1, entityIdentifierPresent: 1, entitySourceCount: 2, sameAsCount: 6,
  schemaCompleteness: 0.75, hasCanonicalDescription: 1, identifierConflict: 0, entityGraphStrength: 75,
  freshnessHours: 12, observedAt: OBSERVED, providerReliability: 0.88, contributingSources: ['wikidata', 'google_kg'],
};

describe('Entity Provider — canonical adapter (BETA-PROVIDER-006)', () => {
  it('converts consolidated entity to canonical Evidence, per-field MEASURED / derived CALCULATED', () => {
    const ev = entityEvidenceAdapter.toEvidence(input, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['knowledge_graph_presence'].value).toBe(1);
    expect(byKey['knowledge_graph_presence'].maturity).toBe('MEASURED');
    expect(byKey['entity_identifier_present'].value).toBe(1);
    expect(byKey['entity_source_count'].value).toBe(2);
    expect(byKey['sameas_count'].value).toBe(6);
    expect(byKey['schema_completeness'].value).toBe(0.75);
    expect(byKey['entity_graph_strength'].value).toBe(75);
    expect(byKey['entity_graph_strength'].maturity).toBe('CALCULATED');
    for (const e of ev) expect(e.sourceType).toBe('external_api');
  });

  it('measured absence (presence=0) is emitted, not omitted (genuine measurement, not fabrication)', () => {
    const absent: EntityEvidenceInput = {
      ...input, knowledgeGraphPresence: 0, entityIdentifierPresent: 0, entitySourceCount: 0,
      sameAsCount: 0, schemaCompleteness: 0, hasCanonicalDescription: 0, entityGraphStrength: 0,
    };
    const ev = entityEvidenceAdapter.toEvidence(absent, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['knowledge_graph_presence'].value).toBe(0);
    expect(byKey['knowledge_graph_presence'].maturity).toBe('MEASURED'); // measured absence
    expect(byKey['entity_identifier_present'].value).toBe(0);
  });

  it('never fabricates: omits fields no provider supplied', () => {
    const sparse: EntityEvidenceInput = {
      subjectId: 'x', knowledgeGraphPresence: 1, entityIdentifierPresent: 1, entitySourceCount: 1,
      sameAsCount: null, schemaCompleteness: null, hasCanonicalDescription: null, identifierConflict: null,
      entityGraphStrength: null, freshnessHours: null, observedAt: OBSERVED, providerReliability: 0.88,
      contributingSources: ['wikidata'],
    };
    const ev = entityEvidenceAdapter.toEvidence(sparse, { observedAt: OBSERVED });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).toContain('knowledge_graph_presence');
    expect(keys).not.toContain('sameas_count');
    expect(keys).not.toContain('schema_completeness');
    expect(keys).not.toContain('entity_graph_strength');
  });

  it('is deterministic', () => {
    expect(entityEvidenceAdapter.toEvidence(input, {})).toEqual(entityEvidenceAdapter.toEvidence(input, {}));
  });

  it('maps failure to canonical Evidence (no silent failure, null value)', () => {
    const ev = entityEvidenceAdapter.onFailure({
      providerId: 'entity_graph', state: PROVIDER_FAILURE.TIMEOUT,
      reason: 'kg timeout', evidenceKey: 'knowledge_graph_presence', observedAt: OBSERVED,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeNull();
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_TIMEOUT');
  });

  it('exposes exactly the declared entity evidence keys', () => {
    expect(entityEvidenceAdapter.supportedEvidence).toEqual([...ENTITY_EVIDENCE_KEYS]);
  });
});

describe('Entity Provider — deterministic multi-provider consolidation (Phase 6)', () => {
  it('single resolved provider passes through', () => {
    const c = consolidateEntityProviders([
      { source: 'wikidata', resolved: true, wikidataQid: 'Q42', schemaCompleteness: 0.6, sameAsTargets: ['https://linkedin.com/x', 'https://crunchbase.com/x'], hasDescription: true, observedAt: OBSERVED },
    ], OBSERVED);
    expect(c.knowledgeGraphPresence).toBe(1);
    expect(c.entityIdentifierPresent).toBe(1);
    expect(c.sameAsCount).toBe(2);
    expect(c.schemaCompleteness).toBe(0.6);
    expect(c.entitySourceCount).toBe(1);
    expect(c.identifierConflict).toBe(0);
  });

  it('Google + Wikidata: max completeness, union sameAs, coverage 2', () => {
    const c = consolidateEntityProviders([
      { source: 'wikidata', resolved: true, wikidataQid: 'Q42', schemaCompleteness: 0.5, sameAsTargets: ['https://a.com', 'https://b.com'], observedAt: OBSERVED },
      { source: 'google_kg', resolved: true, googleKgMid: '/m/xyz', schemaCompleteness: 0.8, sameAsTargets: ['https://b.com', 'https://c.com'], observedAt: OBSERVED },
    ], OBSERVED);
    expect(c.schemaCompleteness).toBe(0.8); // max
    expect(c.sameAsCount).toBe(3); // union a,b,c
    expect(c.entitySourceCount).toBe(2);
    expect(c.entityIdentifierPresent).toBe(1);
  });

  it('surfaces identifier conflict deterministically (two different QIDs)', () => {
    const c = consolidateEntityProviders([
      { source: 'wikidata', resolved: true, wikidataQid: 'Q42', schemaCompleteness: 0.5 },
      { source: 'wikidata_alt', resolved: true, wikidataQid: 'Q99', schemaCompleteness: 0.5 },
    ], OBSERVED);
    expect(c.identifierConflict).toBe(1); // disagreement surfaced, not hidden
  });

  it('measured absence: a lookup ran but resolved no entity → presence 0', () => {
    const c = consolidateEntityProviders([
      { source: 'wikidata', resolved: true, wikidataQid: null, schemaCompleteness: 0, sameAsTargets: [] },
    ], OBSERVED);
    expect(c.knowledgeGraphPresence).toBe(0); // genuine measured absence
    expect(c.entityIdentifierPresent).toBe(0);
    expect(c.entitySourceCount).toBe(0);
  });

  it('drops unresolved providers and de-dups source keys (last wins)', () => {
    const c = consolidateEntityProviders([
      { source: 'wikidata', resolved: false }, // did not resolve → dropped from coverage
      { source: 'google_kg', resolved: true, googleKgMid: '/m/a', schemaCompleteness: 0.4 },
      { source: 'google_kg', resolved: true, googleKgMid: '/m/b', schemaCompleteness: 0.7 }, // dup key → wins
    ], OBSERVED);
    expect(c.schemaCompleteness).toBe(0.7);
    expect(c.entitySourceCount).toBe(1); // only google_kg (deduped), wikidata unresolved
  });

  it('no resolvable lookup yields a null consolidation (distinct from measured absence)', () => {
    const c = consolidateEntityProviders([{ source: 'wikidata', resolved: false }], OBSERVED);
    expect(c.knowledgeGraphPresence).toBeNull();
    expect(c.entitySourceCount).toBeNull();
    expect(c.contributingSources).toEqual([]);
  });
});

describe('Entity Provider — availability + failure governance (bridge)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });

  // Phase 1A — gate consistency. This previously asserted default-OFF
  // (`WIKIDATA_ENABLED === 'true'`), which contradicted the provider registry's
  // default-ON gate (`!== 'false'`). Because the registry drives the report path,
  // the old assertion locked in an activation matrix that reported the OPPOSITE of
  // what the report actually did. Both now share `isWikidataEnabled()`: Wikidata is
  // keyless and ON by default, OFF only on an explicit `WIKIDATA_ENABLED=false`.
  it('is CONFIGURED with no flags — keyless Wikidata is on by default', () => {
    delete process.env.WIKIDATA_ENABLED; delete process.env.GOOGLE_KG_API_KEY;
    expect(isEntityProviderConfigured()).toBe(true);
    const d = registerEntityProvider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isEntityProviderAvailable()).toBe(true);
  });

  it('is UNAVAILABLE only when explicitly disabled', () => {
    process.env.WIKIDATA_ENABLED = 'false'; delete process.env.GOOGLE_KG_API_KEY;
    expect(isEntityProviderConfigured()).toBe(false);
    const d = registerEntityProvider();
    expect(d.authStatus).toBe('unauthenticated');
    expect(d.connectionStatus).toBe('disconnected');
    expect(isEntityProviderAvailable()).toBe(false);
  });

  it('flips to connected when WIKIDATA_ENABLED=true', () => {
    process.env.WIKIDATA_ENABLED = 'true'; delete process.env.GOOGLE_KG_API_KEY;
    const d = registerEntityProvider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isEntityProviderAvailable()).toBe(true);
    expect(entityProviderReliability()).toBe(0.88);
  });

  it('flips to connected when GOOGLE_KG_API_KEY is present', () => {
    delete process.env.WIKIDATA_ENABLED; process.env.GOOGLE_KG_API_KEY = 'key';
    expect(isEntityProviderConfigured()).toBe(true);
    expect(isEntityProviderAvailable()).toBe(true);
  });

  // Phase 1A: "without flags" is now expressed as an EXPLICIT disable, because the
  // canonical default for keyless Wikidata is ON. The guarantee under test is
  // unchanged: when the provider is unavailable there is no network call, no lookup
  // and no fabricated value.
  it('fetch when disabled returns canonical UNAVAILABLE evidence (no network, no lookup, no fabrication)', async () => {
    process.env.WIKIDATA_ENABLED = 'false'; delete process.env.GOOGLE_KG_API_KEY;
    const ev = await fetchEntityEvidence('Acme Corp', 'acme.com', OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });
});
