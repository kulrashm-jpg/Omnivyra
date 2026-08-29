/**
 * D1 — the planner drop reason must come from the PLANNER's taxonomy.
 *
 * `ValidationDimension` (which semantic rule fired) and `DropReasonCode` (the
 * planner's drop vocabulary) are disjoint. A dimension emitted where a drop
 * reason is expected falls through PUBLIC_DROP_REASON to 'UNKNOWN_ERROR', so a
 * well-understood duplicate reaches the user as an unknown failure.
 *
 * Hard-coding a single reason keeps the value in-taxonomy but mislabels the one
 * dimension that is NOT a duplicate. These tests pin both properties.
 */

import {
  plannerDropReasonFor,
  type ValidationDimension,
  type ValidationResult,
} from '../../../lib/shared/campaign/semanticValidation';
import {
  publicDropReason,
  dropReasonMessage,
  type DropReasonCode,
} from '../../../lib/shared/campaign/plannerDiagnostics';

const ALL: ValidationDimension[] = [
  'duplicate_headline', 'duplicate_opening', 'duplicate_cta', 'duplicate_semantic_idea',
  'duplicate_narrative', 'duplicate_slide', 'duplicate_asset', 'cross_platform_duplication',
  'historical_duplication', 'master_idea_consistency',
];

/** The decision `decide()` would reach for a verdict carrying only `d`. */
const decisionFor = (d: ValidationDimension): ValidationResult['decision'] =>
  (['master_idea_consistency', 'duplicate_semantic_idea', 'duplicate_narrative'].includes(d)) ? 'DROP'
    : d === 'cross_platform_duplication' ? 'ADAPT' : 'REGENERATE';

const verdict = (dims: ValidationDimension[], decision?: ValidationResult['decision']): ValidationResult => ({
  decision: decision ?? decisionFor(dims[0]!),
  findings: dims.map((dimension) => ({ dimension, detail: 'detail' })),
  reason: `${dims[0]}: detail`,
});

describe('D1 — every dimension maps into the planner taxonomy', () => {
  test.each(ALL)('%s never resolves to UNKNOWN_ERROR', (dimension) => {
    const code = plannerDropReasonFor(verdict([dimension]));
    expect(publicDropReason(code as DropReasonCode)).not.toBe('UNKNOWN_ERROR');
    expect(dropReasonMessage(code as DropReasonCode))
      .not.toBe('This piece could not be scheduled (cause unknown).');
  });

  test('duplication dimensions map to duplicate_content', () => {
    for (const d of ALL.filter((x) => x !== 'master_idea_consistency')) {
      expect(plannerDropReasonFor(verdict([d]))).toBe('duplicate_content');
    }
  });

  test('a structural violation is NOT reported as a duplicate', () => {
    // The regression a hard-coded 'duplicate_content' would reintroduce: this
    // sends the user hunting for a duplicate that does not exist.
    expect(plannerDropReasonFor(verdict(['master_idea_consistency']))).toBe('validation_failure');
    expect(publicDropReason('validation_failure')).toBe('VALIDATION_FAILED');
  });

  test('the reason follows the DECISION, not findings insertion order', () => {
    // duplicate_headline is pushed first, but master_idea_consistency drives DROP.
    const code = plannerDropReasonFor(verdict(['duplicate_headline', 'master_idea_consistency'], 'DROP'));
    expect(code).toBe('validation_failure');
  });

  test('an empty finding set degrades to an in-taxonomy default', () => {
    const code = plannerDropReasonFor({ decision: 'ACCEPT', findings: [], reason: 'clean' });
    expect(publicDropReason(code as DropReasonCode)).not.toBe('UNKNOWN_ERROR');
  });
});
