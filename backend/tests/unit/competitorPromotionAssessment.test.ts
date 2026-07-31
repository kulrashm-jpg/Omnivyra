/**
 * COMPETITOR-TAXONOMY-P3-SHADOW-PROMOTION-001 — reproducible promotion evidence.
 *
 * Runs the REAL live engine (getFinalCompetitorsSync, always-rank) side-by-side with the
 * calibrated shadow qualification over the 44-case cross-industry dataset and locks the
 * promotion metrics. This is measurement only — it changes nothing in the live engine or the
 * shadow model, and the shadow is NOT promoted or deployed.
 */

import { CALIBRATION_CASES } from '../../services/competitor/qualification/competitorQualificationCalibration';
import { EXTENDED_CALIBRATION_CASES } from '../../services/competitor/qualification/competitorCalibrationDataset';
import { evaluateMultiSignalQualification } from '../../services/competitor/qualification/competitorQualificationModel';
import { getFinalCompetitorsSync } from '../../services/competitorEngineServiceEngineRankingFinal';
import { normalizeCompetitorDomain } from '../../services/competitorEngineServiceModel';

const ALL = [...CALIBRATION_CASES, ...EXTENDED_CALIBRATION_CASES];

function liveSurfaces(caseItem: (typeof ALL)[number]): boolean {
  const out = getFinalCompetitorsSync({ candidates: [caseItem.candidate], context: caseItem.context, alwaysRank: true });
  const dom = normalizeCompetitorDomain(caseItem.candidate.domain ?? caseItem.candidate.name);
  return out.some(
    (c) =>
      normalizeCompetitorDomain(c.domain ?? c.name) === dom ||
      c.name.toLowerCase() === caseItem.candidate.name.toLowerCase(),
  );
}

describe('live vs calibrated shadow — promotion side-by-side', () => {
  const rows = ALL.map((c) => {
    const live = liveSurfaces(c);
    const shadowAccept = evaluateMultiSignalQualification(c.candidate, c.context).decision === 'qualified';
    return { c, live, shadowAccept };
  });

  const agreement = rows.filter((r) => r.live === r.shadowAccept).length;
  const newlyAccepted = rows.filter((r) => !r.live && r.shadowAccept);
  const newlyRejected = rows.filter((r) => r.live && !r.shadowAccept);

  it('every disagreement is a correction of the live engine — zero regressions vs ground truth', () => {
    const newAcceptRegressions = newlyAccepted.filter((r) => !r.c.expectedCompetitor); // shadow adds a non-competitor
    const newRejectRegressions = newlyRejected.filter((r) => r.c.expectedCompetitor); // shadow drops a real competitor
    expect(newAcceptRegressions.map((r) => r.c.id)).toEqual([]);
    expect(newRejectRegressions.map((r) => r.c.id)).toEqual([]);
  });

  it('shadow recovers unseen-industry competitors the live engine drops (recall gain)', () => {
    expect(newlyAccepted.length).toBeGreaterThanOrEqual(1);
    expect(newlyAccepted.every((r) => r.c.expectedCompetitor)).toBe(true);
    expect(newlyAccepted.every((r) => r.c.coverage === 'unseen')).toBe(true);
  });

  it('shadow removes cross-category non-competitors the live engine surfaces (precision gain)', () => {
    expect(newlyRejected.length).toBeGreaterThanOrEqual(1);
    expect(newlyRejected.every((r) => !r.c.expectedCompetitor)).toBe(true);
  });

  it('agreement on the unambiguous cases is high and quantified', () => {
    // Documented, not asserted tightly: agreement is driven down only by live's own errors.
    expect(agreement).toBeGreaterThanOrEqual(28);
    expect(agreement + newlyAccepted.length + newlyRejected.length).toBe(ALL.length);
  });

  it('the borderline band is empty on this set — borderline→live mapping is UNVALIDATED', () => {
    // Promotion readiness gap: no case lands in [40,55). Real traffic must populate + validate it.
    const borderline = ALL.filter(
      (c) => evaluateMultiSignalQualification(c.candidate, c.context).decision === 'borderline',
    );
    expect(borderline.length).toBe(0);
  });
});
