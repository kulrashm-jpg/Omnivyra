/**
 * BETA-REPORT-EXEC-008 — Authority inflow / backlink state honesty (BR-H-001).
 *
 * Locks the truth rule: a heuristic backlinks proxy (source_tags include 'heuristic' but not a real backlink
 * provider) is NEVER presented as `measured` — it is downgraded to the honest `inferred`. A real
 * backlink-provider source ('backlink_api') keeps `measured`. Non-measured states pass through unchanged.
 * `inferred` aggregates exactly like `measured`, so no score/band/confidence value changes.
 */
import { resolveAuthorityInflowState } from '../../services/canonicalReport/canonicalReportBuilder';

describe('BETA-REPORT-EXEC-008 — authority inflow state honesty (BR-H-001)', () => {
  it('downgrades a heuristic "measured" to "inferred"', () => {
    expect(resolveAuthorityInflowState('measured', ['heuristic'])).toBe('inferred');
    expect(resolveAuthorityInflowState('measured', ['backlink_signals', 'heuristic'])).toBe('inferred');
    expect(resolveAuthorityInflowState('measured', [])).toBe('inferred'); // no real-provider proof → not measured
  });

  it('keeps "measured" only when a real backlink provider backs it', () => {
    expect(resolveAuthorityInflowState('measured', ['backlink_api'])).toBe('measured');
    expect(resolveAuthorityInflowState('measured', ['backlink_api', 'heuristic'])).toBe('measured');
  });

  it('passes non-measured states through unchanged (no invention, no over-claim)', () => {
    expect(resolveAuthorityInflowState('unavailable', ['heuristic'])).toBe('unavailable');
    expect(resolveAuthorityInflowState('inferred', ['heuristic'])).toBe('inferred');
    expect(resolveAuthorityInflowState('insufficient_signal', [])).toBe('insufficient_signal');
  });

  it('is deterministic', () => {
    expect(resolveAuthorityInflowState('measured', ['heuristic'])).toBe(resolveAuthorityInflowState('measured', ['heuristic']));
  });
});
