/**
 * COMPETITOR-PRODUCTION-HARDENING-001 — validation for M1 (failure isolation) and M2 (authority
 * integrity). Nothing else is exercised for change.
 */

import { CALIBRATION_CASES } from '../../services/competitor/qualification/competitorQualificationCalibration';
import { EXTENDED_CALIBRATION_CASES } from '../../services/competitor/qualification/competitorCalibrationDataset';
import { getFinalCompetitorsSync } from '../../services/competitorEngineServiceEngineRankingFinal';
import { normalizeCompetitorDomain, type CompanyCompetitiveContext, type CompetitorCandidate } from '../../services/competitorEngineServiceModel';
import * as model from '../../services/competitor/qualification/competitorQualificationModel';
import {
  routeQualificationKeep,
  getRouterMetricsSnapshot,
  resetRouterMetrics,
} from '../../services/competitor/qualification/competitorQualificationRouter';

const ALL = [...CALIBRATION_CASES, ...EXTENDED_CALIBRATION_CASES];
const byId = (id: string) => ALL.find((c) => c.id === id)!;
const ENGINE = 'COMPETITOR_QUALIFICATION_ENGINE';

function surfaces(candidate: CompetitorCandidate, context: CompanyCompetitiveContext, alwaysRank = true): boolean {
  const out = getFinalCompetitorsSync({ candidates: [candidate], context, alwaysRank });
  const dom = normalizeCompetitorDomain(candidate.domain ?? candidate.name);
  return out.some((c) => normalizeCompetitorDomain(c.domain ?? c.name) === dom || c.name.toLowerCase() === candidate.name.toLowerCase());
}

// ── M1: Failure isolation ─────────────────────────────────────────────────────
describe('M1 — authoritative qualification failure isolation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('unit: a thrown qualification never propagates — deterministic legacy fallback', () => {
    jest.spyOn(model, 'evaluateMultiSignalQualification').mockImplementation(() => {
      throw new Error('injected qualification failure');
    });
    resetRouterMetrics();
    const c = byId('logistics-true').candidate;
    const keptWhenLegacyKeeps = routeQualificationKeep({ candidate: c, context: byId('logistics-true').context, legacyKeep: true });
    const droppedWhenLegacyDrops = routeQualificationKeep({ candidate: c, context: byId('logistics-true').context, legacyKeep: false });
    expect(keptWhenLegacyKeeps.fallback).toBe(true);
    expect(keptWhenLegacyKeeps.decision).toBe('fallback');
    expect(keptWhenLegacyKeeps.keep).toBe(true); // == legacyKeep
    expect(droppedWhenLegacyDrops.keep).toBe(false); // == legacyKeep
    // deterministic: same input ⇒ same fallback
    expect(routeQualificationKeep({ candidate: c, context: byId('logistics-true').context, legacyKeep: true })).toEqual(keptWhenLegacyKeeps);
    expect(getRouterMetricsSnapshot().fallbacks).toBe(3);
  });

  it('pipeline: under multisignal authority, a thrown qualification never fails generation and reproduces legacy output', () => {
    const c1 = byId('x-cyber-crm-neg'); // legacy keeps (Tier 3)
    const c2 = byId('logistics-true'); // legacy drops
    // Baseline: legacy authority output.
    delete process.env[ENGINE];
    const legacyOut1 = getFinalCompetitorsSync({ candidates: [c1.candidate], context: c1.context, alwaysRank: true });
    const legacyOut2 = getFinalCompetitorsSync({ candidates: [c2.candidate], context: c2.context, alwaysRank: true });

    // Multisignal authority WITH qualification throwing on every call.
    process.env[ENGINE] = 'multisignal';
    jest.spyOn(model, 'evaluateMultiSignalQualification').mockImplementation(() => {
      throw new Error('boom');
    });
    resetRouterMetrics();
    let out1: unknown, out2: unknown;
    expect(() => { out1 = getFinalCompetitorsSync({ candidates: [c1.candidate], context: c1.context, alwaysRank: true }); }).not.toThrow();
    expect(() => { out2 = getFinalCompetitorsSync({ candidates: [c2.candidate], context: c2.context, alwaysRank: true }); }).not.toThrow();
    // Fallback reproduces legacy behavior exactly (schema, scoring, tier, ranking preserved).
    expect(JSON.stringify(out1)).toBe(JSON.stringify(legacyOut1));
    expect(JSON.stringify(out2)).toBe(JSON.stringify(legacyOut2));
    expect(getRouterMetricsSnapshot().fallbacks).toBeGreaterThanOrEqual(1);
    delete process.env[ENGINE];
  });
});

// ── M2: Authority integrity ───────────────────────────────────────────────────
describe('M2 — multisignal is the sole authority (no legacy pre-filter bypass)', () => {
  const orig = process.env[ENGINE];
  afterEach(() => { if (orig === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = orig; });

  // A genuine competitor + a weak candidate that the legacy score floor (40) would pre-filter.
  const wellness = byId('wellness-true').context;
  const strong = byId('wellness-true').candidate;
  const weak: CompetitorCandidate = {
    name: 'Nimbus Garden Tools', source: 'serp_live', confidenceScore: 0.6,
    category: 'gardening', description: 'garden hand tools, watering cans and pruning shears for home gardens',
  };

  it('the authority router sees the SAME candidates under alwaysRank=true and alwaysRank=false', () => {
    process.env[ENGINE] = 'multisignal';
    resetRouterMetrics();
    getFinalCompetitorsSync({ candidates: [strong, weak], context: wellness, alwaysRank: true });
    const decisionsAlwaysRank = getRouterMetricsSnapshot().decisions;
    resetRouterMetrics();
    getFinalCompetitorsSync({ candidates: [strong, weak], context: wellness, alwaysRank: false });
    const decisionsLegacyFlow = getRouterMetricsSnapshot().decisions;
    // M2: the ranking-stage floor no longer thins candidates before the router.
    expect(decisionsLegacyFlow).toBe(decisionsAlwaysRank);
    expect(decisionsLegacyFlow).toBeGreaterThanOrEqual(2); // both candidates reached the router
  });

  it('a sub-threshold candidate reaches the router under multisignal + alwaysRank=false', () => {
    // Under legacy authority + alwaysRank=false the weak candidate is pre-filtered and the router
    // is never consulted; under multisignal authority it must be routed.
    process.env[ENGINE] = 'multisignal';
    resetRouterMetrics();
    getFinalCompetitorsSync({ candidates: [weak], context: wellness, alwaysRank: false });
    expect(getRouterMetricsSnapshot().decisions).toBeGreaterThanOrEqual(1);
  });

  it('legacy authority is unaffected by M2 (router never invoked, alwaysRank=false)', () => {
    delete process.env[ENGINE];
    resetRouterMetrics();
    getFinalCompetitorsSync({ candidates: [strong, weak], context: wellness, alwaysRank: false });
    expect(getRouterMetricsSnapshot().decisions).toBe(0);
  });
});

// ── M3: Rollback ──────────────────────────────────────────────────────────────
describe('rollback — legacy → multisignal → legacy is 100% byte-identical', () => {
  const orig = process.env[ENGINE];
  afterEach(() => { if (orig === undefined) delete process.env[ENGINE]; else process.env[ENGINE] = orig; });

  it('restores identical output across sync path (default and alwaysRank=false flows)', () => {
    for (const alwaysRank of [true, false]) {
      for (const c of [byId('x-cyber-crm-neg'), byId('wellness-true'), byId('logistics-true')]) {
        delete process.env[ENGINE];
        const before = JSON.stringify(getFinalCompetitorsSync({ candidates: [c.candidate], context: c.context, alwaysRank }));
        process.env[ENGINE] = 'multisignal';
        getFinalCompetitorsSync({ candidates: [c.candidate], context: c.context, alwaysRank }); // exercise multisignal
        delete process.env[ENGINE]; // rollback
        const after = JSON.stringify(getFinalCompetitorsSync({ candidates: [c.candidate], context: c.context, alwaysRank }));
        expect(after).toBe(before);
      }
    }
  });
});
