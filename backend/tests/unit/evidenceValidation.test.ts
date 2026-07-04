/**
 * BETA-ENGINE-008 — Evidence Quality, Validation & Governance.
 *
 * Verifies the canonical validation engine (schema/required/range/timestamp/freshness/duplicate), the
 * deterministic quality model, deterministic conflict resolution (record-all, never overwrite), governance
 * composition, and the orchestrator integration (invalid Evidence rejected before persistence → never
 * reaches a decision engine). Deterministic; no DB; no network.
 */
import {
  validateEvidence, validateEvidenceSet, VALIDATOR_VERSION,
  assessEvidenceQuality, detectConflicts, governEvidence,
  InMemoryEvidenceStore, registerIngestionSpec, __clearIngestionSpecs, ingestProviderEvidence,
  readPersistedEvidence, type IngestionSubject,
} from '../../services/evidencePlatform';
import { createEvidence, type Evidence } from '../../services/evidencePlatform';

const NOW = '2026-02-01T00:00:00.000Z';
const ctx = { nowIso: NOW, maxAgeHours: 24 * 30 };

function ev(key: string, value: number | null, unit: string, opts: Partial<Parameters<typeof createEvidence>[0]> = {}): Evidence {
  return createEvidence({
    engineId: 'provider:reviews', key, value, maturity: value == null ? 'UNAVAILABLE' : 'MEASURED',
    sourceType: 'external_api', measurementType: 'count', unit, observedAt: NOW, collectedAt: NOW,
    ...opts,
  } as any);
}

describe('BETA-ENGINE-008 — validation rules (Phase 2)', () => {
  it('validates a well-formed measured row', () => {
    const r = validateEvidence(ev('review_count', 500, 'count'), ctx);
    expect(r.status).toBe('validated');
    expect(r.reasons).toHaveLength(0);
  });

  it('rejects an out-of-range ratio (impossible value)', () => {
    const r = validateEvidence(ev('ctr', 1.5, 'ratio'), ctx);
    expect(r.status).toBe('rejected');
    expect(r.reasons.map((x) => x.code)).toContain('OUT_OF_RANGE');
  });

  it('rejects a negative count and a rating above 5', () => {
    expect(validateEvidence(ev('review_count', -3, 'count'), ctx).status).toBe('rejected');
    expect(validateEvidence(ev('avg_rating', 6, 'rating_0_5'), ctx).status).toBe('rejected');
  });

  it('rejects a value on UNAVAILABLE evidence (no fabricated measurement)', () => {
    const bad = { ...ev('review_count', null, 'count'), value: 5 } as Evidence; // UNAVAILABLE but has a value
    const r = validateEvidence({ ...bad, maturity: 'UNAVAILABLE' }, ctx);
    expect(r.status).toBe('rejected');
    expect(r.reasons.map((x) => x.code)).toContain('VALUE_ON_UNAVAILABLE');
  });

  it('rejects a future observedAt timestamp', () => {
    const r = validateEvidence(ev('review_count', 10, 'count', { observedAt: '2027-01-01T00:00:00.000Z' }), ctx);
    expect(r.status).toBe('rejected');
    expect(r.reasons.map((x) => x.code)).toContain('FUTURE_TIMESTAMP');
  });

  it('flags (not rejects) expired evidence via freshness', () => {
    const r = validateEvidence(ev('review_count', 10, 'count', { observedAt: '2025-01-01T00:00:00.000Z' }), { nowIso: NOW, maxAgeHours: 24 });
    expect(r.status).toBe('flagged');
    expect(r.reasons.map((x) => x.code)).toContain('EXPIRED_EVIDENCE');
  });

  it('detects duplicate keys in a set (flags them)', () => {
    const report = validateEvidenceSet([ev('review_count', 10, 'count'), ev('review_count', 20, 'count')], ctx);
    expect(report.duplicateKeys).toContain('review_count');
    expect(report.flaggedCount).toBe(2);
  });

  it('removes rejected rows from the valid subset (never enter a decision)', () => {
    const report = validateEvidenceSet([ev('review_count', 500, 'count'), ev('ctr', 2.0, 'ratio')], ctx);
    expect(report.rejectedCount).toBe(1);
    expect(report.valid).toHaveLength(1);
    expect(report.valid[0].id.endsWith(':review_count')).toBe(true);
  });
});

describe('BETA-ENGINE-008 — quality model (Phase 3)', () => {
  it('scores a clean set highly and an invalid set lower', () => {
    const clean = [ev('review_count', 500, 'count'), ev('avg_rating', 4.5, 'rating_0_5')];
    const cleanReport = validateEvidenceSet(clean, ctx);
    const cleanQ = assessEvidenceQuality({ evidence: clean, validation: cleanReport, providerReliability: 0.85 });
    expect(cleanQ.qualityBand).toBe('excellent');
    expect(cleanQ.qualityScore).toBeGreaterThan(0.85);

    const dirty = [ev('review_count', 500, 'count'), ev('ctr', 3.0, 'ratio')];
    const dirtyReport = validateEvidenceSet(dirty, ctx);
    const dirtyQ = assessEvidenceQuality({ evidence: dirty, validation: dirtyReport, providerReliability: 0.85 });
    expect(dirtyQ.qualityScore).toBeLessThan(cleanQ.qualityScore);
    expect(dirtyQ.breakdown.reduce((s, f) => s + f.contribution, 0)).toBeCloseTo(dirtyQ.qualityScore, 3);
  });
});

describe('BETA-ENGINE-008 — conflict resolution (Phase 4)', () => {
  it('records a cross-provider conflict and resolves by highest reliability (never overwrites)', () => {
    const google = createEvidence({ engineId: 'provider:reviews', key: 'avg_rating', value: 4.6, maturity: 'MEASURED', sourceType: 'external_api', unit: 'rating_0_5', observedAt: NOW });
    const trustpilot = createEvidence({ engineId: 'provider:reviews', key: 'avg_rating', value: 3.2, maturity: 'MEASURED', sourceType: 'external_api', unit: 'rating_0_5', observedAt: NOW });
    const report = detectConflicts([
      { providerId: 'google', providerReliability: 0.9, evidence: [google] },
      { providerId: 'trustpilot', providerReliability: 0.8, evidence: [trustpilot] },
    ]);
    expect(report.conflictCount).toBe(1);
    const c = report.conflicts[0];
    expect(c.key).toBe('avg_rating');
    expect(c.values).toHaveLength(2); // both recorded
    expect(c.resolution.chosenProviderId).toBe('google'); // highest reliability
    expect(c.spread).toBeCloseTo(1.4, 5);
  });

  it('does not flag agreement within tolerance', () => {
    const a = createEvidence({ engineId: 'provider:reviews', key: 'avg_rating', value: 4.50, maturity: 'MEASURED', sourceType: 'external_api', unit: 'rating_0_5', observedAt: NOW });
    const b = createEvidence({ engineId: 'provider:reviews', key: 'avg_rating', value: 4.51, maturity: 'MEASURED', sourceType: 'external_api', unit: 'rating_0_5', observedAt: NOW });
    const report = detectConflicts([
      { providerId: 'p1', providerReliability: 0.9, evidence: [a] },
      { providerId: 'p2', providerReliability: 0.8, evidence: [b] },
    ]);
    expect(report.conflictCount).toBe(0);
  });
});

describe('BETA-ENGINE-008 — governance (Phase 5)', () => {
  it('composes validation + quality + conflicts + version', () => {
    const res = governEvidence([ev('review_count', 500, 'count'), ev('ctr', 5.0, 'ratio')], { nowIso: NOW, maxAgeHours: 24 * 30, providerId: 'reviews', providerReliability: 0.85 });
    expect(res.governance.validatorVersion).toBe(VALIDATOR_VERSION);
    expect(res.governance.validatedAt).toBe(NOW);
    expect(res.governance.validation.rejectedCount).toBe(1);
    expect(res.valid).toHaveLength(1); // the bad ctr row removed
    expect(res.governance.quality.qualityScore).toBeGreaterThan(0);
  });
});

describe('BETA-ENGINE-008 — orchestrator integration (Phase 6)', () => {
  afterEach(() => __clearIngestionSpecs());
  const subject: IngestionSubject = { subjectId: 'company-1', brandName: 'Acme', domain: 'acme.com' };

  it('validates before persistence: rejected rows never persist / never reach a decision engine', async () => {
    const mixed = [ev('review_count', 300, 'count'), ev('avg_rating', 9.9, 'rating_0_5')]; // rating impossible
    registerIngestionSpec({ providerId: 'reviews', maxAgeHours: 24 * 30, providerReliability: 0.85, isConfigured: () => true, fetch: () => mixed });
    const store = new InMemoryEvidenceStore();
    const [res] = await ingestProviderEvidence(subject, NOW, { store });

    expect(res.rejectedCount).toBe(1);
    expect(res.evidenceCount).toBe(1); // only the valid row persisted
    const persisted = readPersistedEvidence('reviews', 'company-1', store);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id.endsWith(':review_count')).toBe(true); // the impossible rating never persisted
    // governance retained for traceability
    expect(store.get('reviews', 'company-1')!.governance!.validation.rejectedCount).toBe(1);
  });
});
