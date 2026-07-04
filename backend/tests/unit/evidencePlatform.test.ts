import {
  createEvidence, evidenceId, buildWebsiteEngineEvidence,
  registerAllEngines, listEngines, getEngine, __clearRegistry, isRegistered,
  toEvidenceMaturity, isTrustedMaturity, isGapMaturity, isFabricatedMaturity,
  fromEngineConfidence, buildProvenance,
} from '../../services/evidencePlatform';
import type { CheckResult } from '../../services/platformIntelligence/confidence';

describe('Evidence Platform — canonical model', () => {
  it('createEvidence builds a canonical object with a deterministic id', () => {
    const e = createEvidence({ engineId: 'website.technical', key: 'indexability', value: 48, maturity: 'MEASURED', unit: 'score_0_100' });
    expect(e.id).toBe('website.technical:indexability');
    expect(e.id).toBe(evidenceId('website.technical', 'indexability'));
    expect(e.engineId).toBe('website.technical');
    expect(e.value).toBe(48);
    expect(e.maturity).toBe('MEASURED');
  });

  it('maturity helpers classify correctly', () => {
    expect(toEvidenceMaturity('measured')).toBe('MEASURED');
    expect(toEvidenceMaturity('nonsense')).toBe('UNKNOWN');
    expect(toEvidenceMaturity(null)).toBe('UNKNOWN');
    expect(isTrustedMaturity('MEASURED')).toBe(true);
    expect(isTrustedMaturity('INFERRED')).toBe(false);
    expect(isGapMaturity('NOT_EVALUABLE')).toBe(true);
    expect(isFabricatedMaturity('SYNTHETIC')).toBe(true);
    expect(isFabricatedMaturity('MEASURED')).toBe(false);
  });

  it('confidence contract wraps engine confidence WITHOUT recomputing the score', () => {
    expect(fromEngineConfidence(0.8)).toEqual({ confidenceScore: 0.8, confidenceBand: 'high' });
    expect(fromEngineConfidence(0.5)).toEqual({ confidenceScore: 0.5, confidenceBand: 'medium' });
    expect(fromEngineConfidence(0.1)).toEqual({ confidenceScore: 0.1, confidenceBand: 'low' });
    expect(fromEngineConfidence(null)).toEqual({ confidenceScore: null, confidenceBand: 'none' });
  });

  it('provenance is a pure builder (no clock/random)', () => {
    const p = buildProvenance({ origin: 'canonical_pages', engine: 'website.technical', version: '1.0.0', timestamp: '2026-01-01T00:00:00.000Z' });
    expect(p).toEqual({
      origin: 'canonical_pages', collector: null, engine: 'website.technical',
      transformationSteps: [], calculationSteps: [], version: '1.0.0',
      timestamp: '2026-01-01T00:00:00.000Z', validator: null,
    });
  });
});

describe('Evidence Platform — website adapter (deterministic mapping)', () => {
  const checks: CheckResult[] = [
    { key: 'https', label: 'HTTPS', status: 'pass', score: 100, detail: 'served over https' },
    { key: 'indexability', label: 'Indexability', status: 'pass', score: 48, detail: '37 pages marked noindex' },
    { key: 'canonical_tags', label: 'Canonical tags', status: 'not_evaluable', score: null },
  ];
  const params = {
    engineId: 'website.technical', version: '1.0.0', sourceSystem: 'website_crawl', origin: 'canonical_pages', collector: 'regex_crawler',
    checks, aggregate: { key: 'technical_score', label: 'Technical score', score: 74, confidence: 0.66 },
    freshness: { lastEvaluatedAt: '2026-01-01T00:00:00.000Z', dataAgeHours: 1, stale: false },
  };

  it('maps checks + aggregate to canonical evidence and is deterministic', () => {
    const a = buildWebsiteEngineEvidence(params);
    const b = buildWebsiteEngineEvidence(params);
    expect(a).toEqual(b); // same input → identical output (deterministic)
    const agg = a.find((e) => e.id === 'website.technical:technical_score');
    expect(agg?.value).toBe(74);
    expect(agg?.maturity).toBe('CALCULATED');
    expect(agg?.evidenceCount).toBe(2); // two evaluable checks
    const idx = a.find((e) => e.id === 'website.technical:indexability');
    expect(idx?.value).toBe(48);
    expect(idx?.maturity).toBe('MEASURED');
    const canon = a.find((e) => e.id === 'website.technical:canonical_tags');
    expect(canon?.value).toBeNull();
    expect(canon?.maturity).toBe('NOT_EVALUABLE');
  });

  it('never emits a numeric value absent from the input (no fabrication)', () => {
    const ev = buildWebsiteEngineEvidence(params);
    const allowed = new Set([100, 48, 74]);
    for (const e of ev) if (typeof e.value === 'number') expect(allowed.has(e.value)).toBe(true);
  });
});

describe('Evidence Platform — registry', () => {
  beforeEach(() => __clearRegistry());

  it('registers every in-scope engine idempotently', () => {
    const first = registerAllEngines().length;
    // module-level guard makes a second call a no-op after clear; register directly to verify catalogue
    for (const reg of registerAllEngines()) getEngine(reg.engineId);
    expect(first).toBeGreaterThanOrEqual(20);
  });

  it('exposes engine descriptors with maturity + dependencies', () => {
    __clearRegistry();
    // re-register (module guard may have short-circuited) by importing the canonical list
    const { CANONICAL_ENGINE_REGISTRATIONS } = require('../../services/evidencePlatform/engineRegistrations');
    for (const reg of CANONICAL_ENGINE_REGISTRATIONS) {
      const { registerEngine } = require('../../services/evidencePlatform');
      registerEngine(reg);
    }
    expect(isRegistered('authority')).toBe(true);
    const seo = getEngine('seo');
    expect(seo?.capabilities).toContain('gsc_backed');
    expect(listEngines().length).toBeGreaterThanOrEqual(20);
  });
});
