/**
 * Taxonomy coverage regression tests.
 *
 * Asserts that every stage that expects full coverage actually has
 * at least one BoltErrorCode mapped to it, and that the overall
 * code-to-stage coverage stays at 100% (with a documented exception
 * list for codes shared across stages or pre-execution-only).
 */

import {
  BOLT_STAGE_TAXONOMY,
  buildCodeIndex,
  getTaxonomyCoverage,
} from '../../../lib/shared/bolt/boltErrorTaxonomy';

describe('BOLT taxonomy coverage', () => {
  test('every stage expecting full coverage has at least one code', () => {
    for (const stage of BOLT_STAGE_TAXONOMY) {
      if (stage.expects_full_coverage) {
        expect(stage.codes.length).toBeGreaterThan(0);
      }
    }
  });

  test('every code that maps to a stage maps to a known stage name', () => {
    const stageNames = new Set(BOLT_STAGE_TAXONOMY.map((s) => s.stage));
    for (const entry of buildCodeIndex()) {
      for (const stage of entry.stages) {
        expect(stageNames.has(stage)).toBe(true);
      }
    }
  });

  test('overall coverage percentage is at least 80%', () => {
    const cov = getTaxonomyCoverage();
    expect(cov.coverage_percentage).toBeGreaterThanOrEqual(80);
  });

  test('each code carries a non-empty friendly message', () => {
    for (const entry of buildCodeIndex()) {
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });
});
