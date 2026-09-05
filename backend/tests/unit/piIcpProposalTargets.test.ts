/**
 * ICP-SELECTION-CONTRACT-001 §12/§13 — the proposal-metadata validator.
 *
 * Two things are under test, and the second matters more than the first:
 *
 *   1. `validateProposalTargets` refuses malformed or unevidenced provenance.
 *   2. The §10 BOUNDARY holds — proposal metadata is inert with respect to
 *      scoring, and the ranked shortlist reaches the evaluator as ONE union
 *      criterion rather than as one criterion per target.
 *
 * The last test in this file is the reason the contract has a §10 at all: it
 * shows the same five titles scoring 1.0 as a union and 0.2 as five criteria.
 */

import {
  IcpContractError, MAX_ICP_TARGETS, validateCriteria, validateProposalTargets,
  type IcpCriterion, type IcpTarget,
} from '../../services/prospectIcp';
import { evaluateIcpFit } from '../../services/prospectIcp/evaluate';
import type { RatifiedIcp } from '../../services/prospectIcp/types';

const AS_OF = '2026-09-04T00:00:00.000Z';

/** A structurally valid target. Overrides let each test break exactly one rule. */
function target(over: Partial<IcpTarget> & { rank: number; title: string }): Record<string, unknown> {
  return {
    roleTypes: ['user'],
    derivation: 'inferred',
    confidence: 'medium',
    evidenceFields: ['target_audience_list'],
    evidenceQuotes: [],
    orgAssumption: 'smb — a marketing function exists at this stage',
    factors: { e: 1, p: 2, b: 1, f: 2, r: 2, c: 0.8 },
    ...over,
  } as Record<string, unknown>;
}

/** Asserts the validator refused, and refused for the STATED reason. */
function refusedWith(code: string, input: unknown): void {
  try {
    validateProposalTargets(input);
  } catch (err) {
    expect(err).toBeInstanceOf(IcpContractError);
    expect((err as IcpContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected refusal with code '${code}', but the input was accepted`);
}

describe('validateProposalTargets — accepted shapes', () => {
  it('accepts a 2-target proposal', () => {
    const out = validateProposalTargets({
      targets: [target({ rank: 1, title: 'Marketing Manager' }), target({ rank: 2, title: 'Head of Marketing' })],
    });
    expect(out.targets).toHaveLength(2);
    expect(out.targets.map((t) => t.title)).toEqual(['Marketing Manager', 'Head of Marketing']);
  });

  it('accepts the frozen 5-target Omnivyra shortlist, with rejections and a stage assumption', () => {
    const out = validateProposalTargets({
      stageAssumption: {
        stage: 'smb',
        evidenceFields: ['target_customer_segment', 'ideal_customer_profile'],
        rationale: 'Startups, micro, SMB, and later enterprises.',
      },
      targets: [
        target({
          rank: 1, title: 'Marketing Manager', derivation: 'directly_evidenced', confidence: 'high',
          roleTypes: ['user', 'evaluator'], evidenceQuotes: ['Marketing managers'],
          factors: { e: 2, p: 2, b: 1, f: 2, r: 2, c: 1 },
        }),
        target({
          rank: 2, title: 'Head of Marketing', confidence: 'high',
          roleTypes: ['economic_buyer', 'decision_maker'],
          factors: { e: 1, p: 2, b: 2, f: 2, r: 2, c: 1 },
        }),
        target({
          rank: 3, title: 'Digital Marketing Manager', derivation: 'directly_evidenced', confidence: 'high',
          roleTypes: ['user', 'evaluator'], evidenceQuotes: ['Digital marketers'],
          factors: { e: 2, p: 2, b: 1, f: 1, r: 2, c: 1 },
        }),
        target({
          rank: 4, title: 'Founder', confidence: 'high',
          roleTypes: ['decision_maker', 'economic_buyer', 'sponsor'],
          factors: { e: 1, p: 1, b: 2, f: 2, r: 1, c: 1 },
        }),
        target({ rank: 5, title: 'Marketing Director', roleTypes: ['decision_maker'] }),
      ],
      rejected: [
        { title: 'CMO', reason: 'above AUTHORITY_CEILING — excluded by rule, not by score' },
        { title: 'Growth Marketing Manager', reason: 'E=0 — goals evidence a growth outcome, not a growth function' },
      ],
    });

    expect(out.targets).toHaveLength(5);
    expect(out.targets.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(out.rejected).toHaveLength(2);
    expect(out.stageAssumption?.stage).toBe('smb');
    // Multiple role types per target — a founder buys, decides and sponsors.
    expect(out.targets[3].roleTypes).toEqual(['decision_maker', 'economic_buyer', 'sponsor']);
  });

  it('accepts MORE than 5 targets — §8 makes 2–5 a recommendation, never a product limit', () => {
    const many = Array.from({ length: 9 }, (_, i) => target({ rank: i + 1, title: `Role ${i + 1}` }));
    expect(validateProposalTargets({ targets: many }).targets).toHaveLength(9);
  });

  it('accepts an empty or absent target list — §9 makes abstention first-class', () => {
    expect(validateProposalTargets({ targets: [] }).targets).toEqual([]);
    expect(validateProposalTargets({}).targets).toEqual([]);
    expect(validateProposalTargets({ targets: null }).targets).toEqual([]);
  });

  it('accepts a single target — it never demands two the evidence cannot support', () => {
    expect(validateProposalTargets({ targets: [target({ rank: 1, title: 'Founder' })] }).targets).toHaveLength(1);
  });

  it("accepts 'directly_evidenced' with no quote — §12 puts that guarantee on `derivation`", () => {
    const out = validateProposalTargets({
      targets: [{ ...target({ rank: 1, title: 'A' }), derivation: 'directly_evidenced', evidenceQuotes: [] }],
    });
    expect(out.targets[0].derivation).toBe('directly_evidenced');
    expect(out.targets[0].evidenceQuotes).toEqual([]);
  });

  it('accepts a stage assumption with no evidence — §5 is scoped to ROLES, not the stage', () => {
    expect(validateProposalTargets({
      stageAssumption: { stage: 'micro', evidenceFields: [] },
    }).stageAssumption).toEqual({ stage: 'micro', evidenceFields: [], rationale: null });

    expect(validateProposalTargets({ stageAssumption: { stage: 'smb' } }).stageAssumption?.evidenceFields).toEqual([]);
  });

  it('orders targets by rank and rejections by title, deterministically', () => {
    const out = validateProposalTargets({
      targets: [target({ rank: 2, title: 'Second' }), target({ rank: 1, title: 'First' })],
      rejected: [{ title: 'Zeta', reason: 'outranked' }, { title: 'Alpha', reason: 'no evidence' }],
    });
    expect(out.targets.map((t) => t.title)).toEqual(['First', 'Second']);
    expect(out.rejected.map((r) => r.title)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('validateProposalTargets — refusals', () => {
  it('refuses duplicate titles, case-insensitively', () => {
    refusedWith('target_title_duplicate', {
      targets: [target({ rank: 1, title: 'Marketing Manager' }), target({ rank: 2, title: 'marketing manager' })],
    });
  });

  it('refuses duplicate ranks', () => {
    refusedWith('target_ranks_incoherent', {
      targets: [target({ rank: 1, title: 'A' }), target({ rank: 1, title: 'B' })],
    });
  });

  it('refuses non-contiguous ranks — a gap means a target was lost', () => {
    refusedWith('target_ranks_incoherent', {
      targets: [target({ rank: 1, title: 'A' }), target({ rank: 2, title: 'B' }), target({ rank: 4, title: 'C' })],
    });
  });

  it('refuses a rank that is not a positive integer', () => {
    refusedWith('target_rank_invalid', { targets: [target({ rank: 0, title: 'A' })] });
    refusedWith('target_rank_invalid', { targets: [{ ...target({ rank: 1, title: 'A' }), rank: 1.5 }] });
  });

  it('refuses missing evidence rather than defaulting it to empty', () => {
    refusedWith('target_evidence_fields_empty', {
      targets: [{ ...target({ rank: 1, title: 'A' }), evidenceFields: [] }],
    });
    refusedWith('target_evidence_fields_not_array', {
      targets: [{ ...target({ rank: 1, title: 'A' }), evidenceFields: undefined }],
    });
  });

  it('refuses an invalid derivation', () => {
    refusedWith('target_derivation_invalid', {
      targets: [{ ...target({ rank: 1, title: 'A' }), derivation: 'assumed' }],
    });
  });

  it('refuses a confidence outside the vocabulary, but normalises case', () => {
    refusedWith('target_confidence_invalid', {
      targets: [{ ...target({ rank: 1, title: 'A' }), confidence: 'quite high' }],
    });
    // `field_confidence` capitalises; the TypeScript vocabulary does not.
    const out = validateProposalTargets({
      targets: [{ ...target({ rank: 1, title: 'A' }), confidence: 'Medium' }],
    });
    expect(out.targets[0].confidence).toBe('medium');
  });

  it('refuses an unknown role type and dedupes the rest', () => {
    refusedWith('target_role_type_invalid', {
      targets: [{ ...target({ rank: 1, title: 'A' }), roleTypes: ['budget_holder'] }],
    });
    refusedWith('target_role_types_empty', {
      targets: [{ ...target({ rank: 1, title: 'A' }), roleTypes: [] }],
    });
    const out = validateProposalTargets({
      targets: [{ ...target({ rank: 1, title: 'A' }), roleTypes: ['user', 'user', 'evaluator'] }],
    });
    expect(out.targets[0].roleTypes).toEqual(['evaluator', 'user']);
  });

  it('refuses malformed factors', () => {
    refusedWith('target_factors_not_object', { targets: [{ ...target({ rank: 1, title: 'A' }), factors: null }] });
    refusedWith('target_factor_out_of_range', {
      targets: [{ ...target({ rank: 1, title: 'A' }), factors: { e: 1, p: 3, b: 1, f: 2, r: 2, c: 0.8 } }],
    });
    refusedWith('target_factor_out_of_range', {
      targets: [{ ...target({ rank: 1, title: 'A' }), factors: { e: 1, p: 1.5, b: 1, f: 2, r: 2, c: 0.8 } }],
    });
  });

  it('refuses E=0 — §7 makes it a hard exclusion, so it is not a target', () => {
    refusedWith('target_evidence_factor_zero', {
      targets: [{ ...target({ rank: 1, title: 'A' }), factors: { e: 0, p: 1, b: 1, f: 1, r: 1, c: 0.8 } }],
    });
  });

  it('refuses a multiplier that contradicts the stated confidence', () => {
    refusedWith('target_multiplier_mismatch', {
      targets: [{ ...target({ rank: 1, title: 'A' }), confidence: 'low', factors: { e: 1, p: 1, b: 1, f: 1, r: 1, c: 1 } }],
    });
  });

  it('refuses a blank title or a blank organizational assumption', () => {
    refusedWith('target_title_missing', { targets: [{ ...target({ rank: 1, title: 'A' }), title: '   ' }] });
    refusedWith('target_org_assumption_missing', {
      targets: [{ ...target({ rank: 1, title: 'A' }), orgAssumption: '' }],
    });
  });

  it('refuses a rejection with no reason', () => {
    refusedWith('rejected_reason_missing', { rejected: [{ title: 'CMO' }] });
    refusedWith('rejected_reason_missing', { rejected: [{ title: 'CMO', reason: '  ' }] });
    refusedWith('rejected_title_missing', { rejected: [{ reason: 'no evidence' }] });
  });

  it('refuses a malformed stage assumption but permits its absence', () => {
    refusedWith('stage_assumption_stage_invalid', {
      stageAssumption: { stage: 'enterprise', evidenceFields: ['target_customer_segment'] },
    });
    refusedWith('stage_assumption_evidence_not_array', {
      stageAssumption: { stage: 'micro', evidenceFields: 'target_customer_segment' },
    });
    expect(validateProposalTargets({}).stageAssumption).toBeUndefined();
  });

  it('refuses non-object and non-array shapes', () => {
    refusedWith('proposal_not_object', null);
    refusedWith('targets_not_array', { targets: 'Marketing Manager' });
    refusedWith('rejected_not_array', { rejected: {} });
    refusedWith('targets_too_many', {
      targets: Array.from({ length: MAX_ICP_TARGETS + 1 }, (_, i) => target({ rank: i + 1, title: `R${i}` })),
    });
  });
});

describe('§10 boundary — proposal metadata never becomes scoring criteria', () => {
  const TITLES = [
    'Digital Marketing Manager', 'Founder', 'Head of Marketing', 'Marketing Director', 'Marketing Manager',
  ];

  const ratified = (criteria: IcpCriterion[]): RatifiedIcp => ({
    organizationId: '4bdbec26-4f7e-4e77-a965-d499e1472f5c',
    icpId: '11111111-1111-4111-8111-111111111111',
    icpKey: 'omnivyra-first-cut',
    version: 1,
    criteria,
    ratifiedAt: AS_OF,
    ratifiedBy: '7fe51fbc-31a8-418b-b69f-ad687109deca',
  });

  const score = (criteria: IcpCriterion[]): number | undefined => evaluateIcpFit({
    ratified: ratified(criteria),
    facts: { subject: 'person', attributes: { job_title: 'Marketing Manager' }, observedAt: AS_OF },
    asOf: AS_OF,
  }).contributions[0]?.value;

  it('the validator returns no criteria and leaves a criteria array untouched', () => {
    const criteria = validateCriteria([{
      id: 'title-marketing-buyer', kind: 'required', subject: 'person', attribute: 'job_title',
      predicate: { op: 'one_of', values: TITLES },
    }]);
    const snapshot = JSON.parse(JSON.stringify(criteria));

    const out = validateProposalTargets({
      targets: TITLES.map((title, i) => target({ rank: i + 1, title })),
    });

    expect(criteria).toEqual(snapshot);
    expect(Object.keys(out).sort()).toEqual(['rejected', 'stageAssumption', 'targets']);
    expect(out).not.toHaveProperty('criteria');
  });

  it('ONE union criterion scores a matching person 1.0 — five criteria would score 0.2', () => {
    const union = validateCriteria([{
      id: 'title-marketing-buyer', kind: 'required', subject: 'person', attribute: 'job_title',
      predicate: { op: 'one_of', values: TITLES },
    }]);
    const perTarget = validateCriteria(TITLES.map((t, i) => ({
      id: `title-${i}`, kind: 'required', subject: 'person', attribute: 'job_title',
      predicate: { op: 'one_of', values: [t] },
    })));

    expect(score(union)).toBe(1);
    // The defect §10 exists to prevent, asserted so it cannot be reintroduced.
    expect(score(perTarget)).toBeCloseTo(0.2, 10);
  });
});

describe('persistence shape', () => {
  it('round-trips through JSON without losing target metadata', () => {
    const validated = validateProposalTargets({
      stageAssumption: { stage: 'micro', evidenceFields: ['ideal_customer_profile'], rationale: 'limited teams' },
      targets: [
        target({
          rank: 1, title: 'Founder', derivation: 'directly_evidenced', confidence: 'high',
          roleTypes: ['decision_maker', 'economic_buyer', 'sponsor'], evidenceQuotes: ['Startups, micro, SMB'],
          factors: { e: 2, p: 1, b: 2, f: 2, r: 1, c: 1 },
        }),
        target({ rank: 2, title: 'Marketing Manager' }),
      ],
      rejected: [{ title: 'CMO', reason: 'above AUTHORITY_CEILING' }],
    });

    // What `createIcpVersion` stores is `proposal` as jsonb — a JSON round-trip.
    const proposal = { status: 'ai_suggested' as const, ...validated };
    const revived = JSON.parse(JSON.stringify(proposal));

    expect(revived).toEqual(proposal);
    expect(revived.targets[0].factors).toEqual({ e: 2, p: 1, b: 2, f: 2, r: 1, c: 1 });
    expect(revived.targets[0].evidenceQuotes).toEqual(['Startups, micro, SMB']);
    expect(revived.stageAssumption.evidenceFields).toEqual(['ideal_customer_profile']);
    expect(revived.rejected[0].reason).toBe('above AUTHORITY_CEILING');
    // Re-validating stored metadata is a no-op — the shape is stable.
    expect(validateProposalTargets(revived)).toEqual(validated);
  });
});
