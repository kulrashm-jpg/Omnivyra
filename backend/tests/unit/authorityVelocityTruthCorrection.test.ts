/**
 * BETA-REPORT-EXEC-004 — Authority Velocity truth correction (BR-C-001).
 *
 * Locks the truth-preserving fix: the dimension whose value is `freshness_score` is labeled + explained for
 * what it actually measures (content freshness), NOT as a measured authority growth rate. The internal key
 * and pillar are unchanged (no scoring/structure redesign; the 0-100 value is untouched). Real velocity
 * (rate + classification) remains exposed separately via the authority trajectory.
 */
import { CANONICAL_DIMENSIONS } from '../../services/canonicalReport/canonicalReportTypes';

describe('BETA-REPORT-EXEC-004 — Authority Velocity truth correction (BR-C-001)', () => {
  const dim = CANONICAL_DIMENSIONS.find((d) => d.key === 'authority_velocity');

  it('is labeled for what it measures (content freshness), not velocity', () => {
    expect(dim).toBeDefined();
    expect(dim!.label).toBe('Content Freshness');
    expect(dim!.label).not.toMatch(/velocity/i);
  });

  it('no canonical dimension is presented as "Authority Velocity" anymore', () => {
    expect(CANONICAL_DIMENSIONS.some((d) => /authority velocity/i.test(d.label))).toBe(false);
  });

  it('the rationale honestly disclaims a measured growth rate', () => {
    expect(dim!.rationale.toLowerCase()).toContain('not a measured authority growth rate');
    expect(dim!.rationale.toLowerCase()).not.toContain('rate of change');
  });

  it('keeps the internal key + pillar unchanged (no scoring/structure redesign)', () => {
    expect(dim!.key).toBe('authority_velocity');
    expect(dim!.pillar).toBe('momentum');
  });
});
