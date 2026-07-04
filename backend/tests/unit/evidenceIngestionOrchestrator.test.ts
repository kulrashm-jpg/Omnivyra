/**
 * BETA-ENGINE-007 — Canonical Evidence Ingestion & Orchestration.
 *
 * Verifies the one reusable orchestration layer: freshness classification, fetch→validate→persist,
 * one-fetch-many-consumers (fresh reuse), failure governance + retry, context resolvers, and the full
 * end-to-end chain (provider fetch → canonical Evidence → persistence → decision-engine confidence).
 * Deterministic; no DB; no network.
 */
import {
  classifyFreshness, needsRefresh, ageHours,
  InMemoryEvidenceStore,
  registerIngestionSpec, __clearIngestionSpecs, ingestProviderEvidence, ingestProvider,
  resolveAuthorityEvidenceContext, resolveTrustEvidenceContext,
  type IngestionSubject,
} from '../../services/evidencePlatform';
import { deriveDecisionConfidence } from '../../services/evidencePlatform';
import { evidenceValue, summarizeEvidence } from '../../services/evidencePlatform';
import { entityEvidenceAdapter } from '../../services/evidencePlatform/providers/entity/entityEvidenceAdapter';
import type { Evidence } from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';
const subject: IngestionSubject = { subjectId: 'company-1', brandName: 'Acme', domain: 'acme.com' };

describe('BETA-ENGINE-007 — freshness (Phase 6)', () => {
  it('classifies fresh / stale / expired deterministically against maxAge', () => {
    const maxAge = 100;
    expect(classifyFreshness('2026-02-01T00:00:00.000Z', '2026-02-01T10:00:00.000Z', maxAge)).toBe('fresh'); // 10h < 50
    expect(classifyFreshness('2026-02-01T00:00:00.000Z', '2026-02-03T12:00:00.000Z', maxAge)).toBe('stale'); // 60h in [50,100)
    expect(classifyFreshness('2026-02-01T00:00:00.000Z', '2026-02-06T00:00:00.000Z', maxAge)).toBe('expired'); // 120h >= 100
    expect(classifyFreshness(null, NOW, maxAge)).toBe('refresh_required');
  });

  it('record status short-circuits + needsRefresh is deterministic', () => {
    expect(classifyFreshness(NOW, NOW, 100, 'refresh_in_progress')).toBe('refresh_in_progress');
    expect(classifyFreshness(NOW, NOW, 100, 'refresh_failed')).toBe('refresh_failed');
    expect(needsRefresh('expired')).toBe(true);
    expect(needsRefresh('refresh_failed')).toBe(true);
    expect(needsRefresh('fresh')).toBe(false);
    expect(ageHours('2026-02-01T00:00:00.000Z', '2026-02-01T06:00:00.000Z')).toBe(6);
  });
});

describe('BETA-ENGINE-007 — orchestrator (Phase 2/3/7)', () => {
  afterEach(() => __clearIngestionSpecs());

  it('skips unconfigured providers (no fetch; engines fall back)', async () => {
    let fetched = false;
    registerIngestionSpec({ providerId: 'p', maxAgeHours: 24, isConfigured: () => false, fetch: () => { fetched = true; return []; } });
    const store = new InMemoryEvidenceStore();
    const [res] = await ingestProviderEvidence(subject, NOW, { store });
    expect(res.outcome).toBe('skipped_unconfigured');
    expect(fetched).toBe(false);
    expect(store.get('p', 'company-1')).toBeNull();
  });

  it('fetches, validates, and persists canonical Evidence when configured', async () => {
    const ev = entityEvidenceAdapter.toEvidence({
      subjectId: 'Acme', knowledgeGraphPresence: 1, entityIdentifierPresent: 1, entitySourceCount: 1,
      sameAsCount: 8, schemaCompleteness: 0.8, hasCanonicalDescription: 1, identifierConflict: 0,
      entityGraphStrength: 80, freshnessHours: 1, observedAt: NOW, providerReliability: 0.88, contributingSources: ['wikidata'],
    }, { observedAt: NOW });
    registerIngestionSpec({ providerId: 'entity_graph', maxAgeHours: 24, isConfigured: () => true, fetch: () => ev });
    const store = new InMemoryEvidenceStore();
    const [res] = await ingestProviderEvidence(subject, NOW, { store });
    expect(res.outcome).toBe('persisted');
    expect(res.measured).toBe(true);
    expect(res.freshness).toBe('fresh');
    const rec = store.get('entity_graph', 'company-1')!;
    expect(rec.status).toBe('ready');
    expect(rec.evidence.length).toBe(ev.length);
  });

  it('one fetch, many consumers — a fresh record is reused, not re-fetched', async () => {
    let fetchCount = 0;
    registerIngestionSpec({ providerId: 'p', maxAgeHours: 24, isConfigured: () => true, fetch: () => { fetchCount++; return []; } });
    const store = new InMemoryEvidenceStore();
    await ingestProvider({ providerId: 'p', maxAgeHours: 24, isConfigured: () => true, fetch: () => { fetchCount++; return []; } }, subject, NOW, { store });
    const before = fetchCount;
    // second ingest within freshness window → reused, no new fetch
    const [res] = await ingestProviderEvidence(subject, '2026-02-01T01:00:00.000Z', { store });
    expect(res.outcome).toBe('reused_fresh');
    expect(fetchCount).toBe(before);
  });

  it('failure governance: a throwing fetch retries then persists a canonical UNAVAILABLE Evidence', async () => {
    let attempts = 0;
    registerIngestionSpec({ providerId: 'p', maxAgeHours: 24, isConfigured: () => true, fetch: () => { attempts++; throw new Error('boom'); } });
    const store = new InMemoryEvidenceStore();
    const [res] = await ingestProviderEvidence(subject, NOW, { store, retries: 3 });
    expect(attempts).toBe(3); // retried
    expect(res.outcome).toBe('persisted');
    expect(res.measured).toBe(false);
    const rec = store.get('p', 'company-1')!;
    expect(rec.status).toBe('refresh_failed');
    expect(rec.evidence[0].maturity).toBe('UNAVAILABLE'); // no silent degradation
  });
});

describe('BETA-ENGINE-007 — context resolvers (Phase 5)', () => {
  it('resolves persisted Evidence into engine contexts; empty when absent', () => {
    const store = new InMemoryEvidenceStore();
    expect(resolveAuthorityEvidenceContext('company-1', store).entityEvidence).toBeNull();
    expect(resolveTrustEvidenceContext('company-1', store).reputationEvidence).toBeNull();

    const ev: Evidence[] = entityEvidenceAdapter.toEvidence({
      subjectId: 'Acme', knowledgeGraphPresence: 1, entityIdentifierPresent: 1, entitySourceCount: 1,
      sameAsCount: 5, schemaCompleteness: 0.7, hasCanonicalDescription: 1, identifierConflict: 0,
      entityGraphStrength: 70, freshnessHours: 1, observedAt: NOW, providerReliability: 0.88, contributingSources: ['wikidata'],
    }, { observedAt: NOW });
    store.put({ providerId: 'entity_graph', subjectId: 'company-1', evidence: ev, fetchedAt: NOW, status: 'ready', failureReason: null });
    expect(resolveAuthorityEvidenceContext('company-1', store).entityEvidence).toHaveLength(ev.length);
  });
});

describe('BETA-ENGINE-007 — end-to-end: provider → persist → decision-engine confidence (Phase 8)', () => {
  afterEach(() => __clearIngestionSpecs());

  it('persisted entity Evidence flows through to a higher authority confidence than the empty baseline', async () => {
    const strongEv = entityEvidenceAdapter.toEvidence({
      subjectId: 'Acme', knowledgeGraphPresence: 1, entityIdentifierPresent: 1, entitySourceCount: 2,
      sameAsCount: 10, schemaCompleteness: 0.9, hasCanonicalDescription: 1, identifierConflict: 0,
      entityGraphStrength: 90, freshnessHours: 1, observedAt: NOW, providerReliability: 0.88, contributingSources: ['wikidata', 'google_kg'],
    }, { observedAt: NOW });

    const store = new InMemoryEvidenceStore();
    registerIngestionSpec({ providerId: 'entity_graph', maxAgeHours: 24, isConfigured: () => true, fetch: () => strongEv });
    await ingestProviderEvidence(subject, NOW, { store });

    // The authority engine consumes the PERSISTED Evidence (mirrors its evidence-aware branch).
    const ctx = resolveAuthorityEvidenceContext('company-1', store);
    const entityEvidence = ctx.entityEvidence!;
    const s = summarizeEvidence(entityEvidence);
    const persistedConfidence = deriveDecisionConfidence({
      maturity: 'MEASURED', sampleSize: 40,
      completeness: (1 + (evidenceValue(entityEvidence, 'schema_completeness') ?? 0)) / 2,
      coverage: (evidenceValue(entityEvidence, 'knowledge_graph_presence') ?? 0) > 0 ? Math.min(1, (evidenceValue(entityEvidence, 'sameas_count') ?? 0) / 8) : 0,
      providerReliability: s.meanReliability ?? 0.88, dataPresent: true,
    });
    const emptyBaseline = deriveDecisionConfidence({ maturity: 'INFERRED', sampleSize: 40, completeness: 1, dataPresent: true });

    expect(ctx.entityEvidence).not.toBeNull();
    expect(persistedConfidence.maturity).toBe('MEASURED');
    expect(persistedConfidence.confidenceScore).toBeGreaterThan(emptyBaseline.confidenceScore);
  });
});
