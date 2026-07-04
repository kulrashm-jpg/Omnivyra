/**
 * BETA-ENGINE-006 — Deep (sample-level) evidence adoption.
 *
 * Verifies the evidence-aware confidence helper and that ACTUAL measured provider Evidence — not just
 * provider availability — drives decision confidence: strong entity graph → higher authority confidence,
 * weak → lower; high review count → higher trust confidence, low → lower. Deterministic; no DB; no fetch.
 */
import { deriveDecisionConfidence } from '../../services/evidencePlatform';
import {
  evidenceValue, hasMeasuredEvidence, measuredCount, summarizeEvidence, evidenceKey,
} from '../../services/evidencePlatform';
import { entityEvidenceAdapter, type EntityEvidenceInput } from '../../services/evidencePlatform/providers/entity/entityEvidenceAdapter';
import { reviewsEvidenceAdapter, type ReputationEvidenceInput } from '../../services/evidencePlatform/providers/reputation/reviewsEvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';

const OBSERVED = '2026-01-31T00:00:00.000Z';

const entityInput = (strong: boolean): EntityEvidenceInput => ({
  subjectId: 'Acme',
  knowledgeGraphPresence: strong ? 1 : 0,
  entityIdentifierPresent: strong ? 1 : 0,
  entitySourceCount: strong ? 2 : 0,
  sameAsCount: strong ? 10 : 0,
  schemaCompleteness: strong ? 0.9 : 0.05,
  hasCanonicalDescription: strong ? 1 : 0,
  identifierConflict: 0,
  entityGraphStrength: strong ? 90 : 3,
  freshnessHours: 12,
  observedAt: OBSERVED, providerReliability: 0.88, contributingSources: strong ? ['wikidata', 'google_kg'] : ['wikidata'],
});

const reputationInput = (reviewCount: number, sourceCount: number): ReputationEvidenceInput => ({
  subjectId: 'Acme', avgRating: 4.3, reviewCount, sourceCount, verifiedReviews: reviewCount,
  recentReviews: Math.round(reviewCount / 10), reviewVelocityPerDay: 1, sentimentPositiveRatio: 0.7,
  sentimentNegativeRatio: 0.1, responseRate: 0.6, avgResponseHours: 12, ownerResponses: reviewCount,
  ratingSpread: 0.4, reviewParity: 0.9, freshnessHours: 12, observedAt: OBSERVED,
  providerReliability: 0.85, contributingSources: Array.from({ length: sourceCount }, (_, i) => `src${i}`),
});

// Mirror the authority engine's evidence-aware confidence branch (backlink sample fixed at 40 rows, 100% measured).
function authorityConfidence(entityEvidence: ReturnType<typeof entityEvidenceAdapter.toEvidence>) {
  const backlinkCompleteness = 1;
  const schemaCompleteness = evidenceValue(entityEvidence, 'schema_completeness');
  const sameAs = evidenceValue(entityEvidence, 'sameas_count') ?? 0;
  const presence = evidenceValue(entityEvidence, 'knowledge_graph_presence') ?? 0;
  const s = summarizeEvidence(entityEvidence);
  return deriveDecisionConfidence({
    maturity: 'MEASURED',
    sampleSize: 40,
    completeness: schemaCompleteness != null ? (backlinkCompleteness + schemaCompleteness) / 2 : backlinkCompleteness,
    coverage: presence > 0 ? Math.max(0, Math.min(1, sameAs / 8)) : 0,
    providerReliability: s.meanReliability ?? 0.88,
    dataPresent: true,
  });
}

// Mirror the trust engine's evidence-aware confidence branch.
function trustConfidence(reputationEvidence: ReturnType<typeof reviewsEvidenceAdapter.toEvidence>) {
  const reviewCount = evidenceValue(reputationEvidence, 'review_count') ?? 0;
  const sourceCount = evidenceValue(reputationEvidence, 'review_source_count') ?? 0;
  const s = summarizeEvidence(reputationEvidence);
  return deriveDecisionConfidence({
    maturity: 'MEASURED',
    sampleSize: reviewCount,
    coverage: Math.max(0, Math.min(1, sourceCount / 4)),
    providerReliability: s.meanReliability ?? 0.85,
    dataPresent: reviewCount > 0,
  });
}

describe('BETA-ENGINE-006 — evidence-aware helper', () => {
  it('extracts measured numeric values by canonical key', () => {
    const ev = entityEvidenceAdapter.toEvidence(entityInput(true), { observedAt: OBSERVED });
    expect(evidenceValue(ev, 'sameas_count')).toBe(10);
    expect(evidenceValue(ev, 'schema_completeness')).toBe(0.9);
    expect(evidenceValue(ev, 'nonexistent_key')).toBeNull();
  });

  it('detects measured evidence and ignores UNAVAILABLE failure rows', () => {
    const measured = entityEvidenceAdapter.toEvidence(entityInput(true), { observedAt: OBSERVED });
    expect(hasMeasuredEvidence(measured)).toBe(true);
    expect(measuredCount(measured)).toBeGreaterThan(0);

    const failure = entityEvidenceAdapter.onFailure({
      providerId: 'entity_graph', state: PROVIDER_FAILURE.UNAVAILABLE, reason: 'x',
      evidenceKey: 'knowledge_graph_presence', observedAt: OBSERVED,
    });
    expect(hasMeasuredEvidence(failure)).toBe(false); // UNAVAILABLE is not measured
    expect(hasMeasuredEvidence([])).toBe(false);
    expect(hasMeasuredEvidence(null)).toBe(false);
  });

  it('summarizes measured evidence deterministically', () => {
    const ev = entityEvidenceAdapter.toEvidence(entityInput(true), { observedAt: OBSERVED });
    const s = summarizeEvidence(ev);
    expect(s.measured).toBe(ev.length);
    expect(s.completeness).toBe(1);
    expect(s.maturity).toBe('MEASURED');
    expect(s.measuredKeys).toContain('sameas_count');
  });
});

describe('BETA-ENGINE-006 — measured entity Evidence drives authority confidence (Phase 3)', () => {
  it('strong entity graph → higher authority confidence than a weak one', () => {
    const strong = authorityConfidence(entityEvidenceAdapter.toEvidence(entityInput(true), { observedAt: OBSERVED }));
    const weak = authorityConfidence(entityEvidenceAdapter.toEvidence(entityInput(false), { observedAt: OBSERVED }));
    expect(strong.confidenceScore).toBeGreaterThan(weak.confidenceScore);
    expect(strong.maturity).toBe('MEASURED');
  });

  it('is deterministic (same evidence → same confidence)', () => {
    const a = authorityConfidence(entityEvidenceAdapter.toEvidence(entityInput(true), { observedAt: OBSERVED }));
    const b = authorityConfidence(entityEvidenceAdapter.toEvidence(entityInput(true), { observedAt: OBSERVED }));
    expect(a.confidenceScore).toBe(b.confidenceScore);
  });
});

describe('BETA-ENGINE-006 — measured reputation Evidence drives trust confidence (Phase 3)', () => {
  it('high review count → higher trust confidence than a low one', () => {
    const many = trustConfidence(reviewsEvidenceAdapter.toEvidence(reputationInput(500, 4), { observedAt: OBSERVED }));
    const few = trustConfidence(reviewsEvidenceAdapter.toEvidence(reputationInput(5, 1), { observedAt: OBSERVED }));
    expect(many.confidenceScore).toBeGreaterThan(few.confidenceScore);
  });

  it('broader platform coverage → higher confidence at equal review count', () => {
    const broad = trustConfidence(reviewsEvidenceAdapter.toEvidence(reputationInput(200, 4), { observedAt: OBSERVED }));
    const narrow = trustConfidence(reviewsEvidenceAdapter.toEvidence(reputationInput(200, 1), { observedAt: OBSERVED }));
    expect(broad.confidenceScore).toBeGreaterThan(narrow.confidenceScore);
  });
});
