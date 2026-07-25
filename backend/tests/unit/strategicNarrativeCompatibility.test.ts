/**
 * PRODUCT-IMPLEMENTATION-001 — Strategic Narrative Compatibility Guard Rails.
 *
 * TESTS ONLY. No runtime behaviour is changed by this package. These convert the
 * PRODUCT-QUALITY-001 architectural findings into executable gates so that future
 * narrative-quality work cannot silently:
 *   • alter execution-stage assignment (`campaign_angle` carries the 'conversion' token),
 *   • change blog angle classification (`deriveAngleType` trigger words),
 *   • break the intelligence schema / serialization contract,
 *   • introduce nondeterminism,
 *   • or regress the restored `authority_reason` nullability semantics.
 *
 * Future packages should NOT copy these tests — they should call
 * `runNarrativeCompatibilitySuite(candidateProducer)` (see the final block).
 */
import {
  runNarrativeCompatibilitySuite,
  checkCampaignAngleTokenContract,
  checkAngleClassificationContract,
  checkSequencingStageParity,
  checkAuthorityReasonContract,
  checkDeterminism,
  checkSchemaContract,
  buildNarrativeCorpus,
  currentNarrativeProducer,
  intelligenceOf,
  hashOf,
  STRATEGIC_FIELDS,
  ANGLE_TYPE_TRIGGER_TOKENS,
  REFERENCE_STAGE_DISTRIBUTION,
  FLAG_SETS,
} from '../support/strategicNarrativeCompatibility';

describe('Phase 1 — campaign_angle token contract', () => {
  it('emits "Conversion" IFF diamond_candidate (drives the conversion execution stage)', () => {
    const r = checkCampaignAngleTokenContract(currentNarrativeProducer);
    expect(r.checked).toBe(300);
    expect(r.flagCombosCovered).toBe(FLAG_SETS.length); // no missing combination
  });

  it('never produces an angle that would reclassify via deriveAngleType', () => {
    const r = checkAngleClassificationContract(currentNarrativeProducer);
    expect(r.checked).toBe(300);
    expect(r.classes).toEqual({ analytical: 300 });
  });

  it('pins the exact trigger-token list guarded against', () => {
    // If deriveAngleType gains a new trigger word, this fails and the harness must be updated.
    expect([...ANGLE_TYPE_TRIGGER_TOKENS]).toEqual([
      'contrarian', 'challenge', 'myth', 'wrong',
      'strategic', 'lever', 'outcome', 'decision', 'roi',
    ]);
  });

  it('execution-stage assignment matches the compatibility reference exactly', () => {
    const r = checkSequencingStageParity(currentNarrativeProducer);
    expect(r.stages).toEqual(REFERENCE_STAGE_DISTRIBUTION);
  });
});

describe('Phase 2 — authority_reason contract', () => {
  it('is null when not authority-elevated OR no authority domains; a string otherwise', () => {
    const r = checkAuthorityReasonContract(currentNarrativeProducer);
    expect(r.nullCases).toBeGreaterThan(0);
    expect(r.valueCases).toBeGreaterThan(0);
    expect(r.nullCases + r.valueCases).toBe(300);
  });

  it('non-null authority_reason is what promotes a card to the authority stage', () => {
    // Guards the coupling itself: this is why nullability is load-bearing.
    const corpus = buildNarrativeCorpus();
    const withAuthority = corpus.flatMap((c) =>
      currentNarrativeProducer(c.recs.map((r) => ({ ...r })), c.profile)
        .filter((row) => intelligenceOf(row).authority_reason !== null));
    expect(withAuthority.length).toBeGreaterThan(0);
  });
});

describe('Phase 3 — determinism', () => {
  it('identical corpus over multiple runs → identical outputs, hashes and ordering', () => {
    const r = checkDeterminism(currentNarrativeProducer, 5);
    expect(r.runs).toBe(5);
    expect(r.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is a pure function of (recommendations, profile) — no ambient state', () => {
    const [c] = buildNarrativeCorpus();
    const a = currentNarrativeProducer(c.recs.map((r) => ({ ...r })), c.profile).map(intelligenceOf);
    // interleave an unrelated call, then repeat — result must be unchanged
    currentNarrativeProducer(buildNarrativeCorpus()[7].recs, buildNarrativeCorpus()[7].profile);
    const b = currentNarrativeProducer(c.recs.map((r) => ({ ...r })), c.profile).map(intelligenceOf);
    expect(hashOf(a)).toBe(hashOf(b));
  });
});

describe('Phase 4 — schema / serialization backward compatibility', () => {
  it('exact property names, nullability, and lossless stable serialization', () => {
    const r = checkSchemaContract(currentNarrativeProducer);
    expect(r.checked).toBe(300);
  });

  it('pins the canonical field set (snake_case, exactly six)', () => {
    expect([...STRATEGIC_FIELDS]).toEqual([
      'problem_being_solved', 'gap_being_filled', 'why_now',
      'authority_reason', 'expected_transformation', 'campaign_angle',
    ]);
  });

  it('enrichment is additive — source recommendation fields survive', () => {
    const [c] = buildNarrativeCorpus();
    const out = currentNarrativeProducer(c.recs.map((r) => ({ ...r })), c.profile);
    expect(out[0]).toMatchObject({
      topic: c.recs[0].topic,
      polished_title: c.recs[0].polished_title,
      volume: c.recs[0].volume,
    });
  });
});

describe('Phase 5 — reusable harness (how future packages consume this)', () => {
  it('the aggregate suite passes for the current producer', () => {
    const report = runNarrativeCompatibilitySuite();
    expect(report.cases).toBe(60);
    expect(report.cards).toBe(300);
    expect(report.stages).toEqual(REFERENCE_STAGE_DISTRIBUTION);
    expect(report.angleClasses).toEqual({ analytical: 300 });
    expect(report.schemaChecked).toBe(300);
  });

  it('detects a contract violation in a candidate producer (the harness actually bites)', () => {
    // A plausible-looking "improvement" that drops the 'Conversion' token — exactly the
    // regression PRODUCT-QUALITY-001 warned about. The harness must reject it.
    const badCandidate = (recs: Array<Record<string, unknown> & { topic: string }>, profile: never) =>
      currentNarrativeProducer(recs, profile).map((row) => ({
        ...row,
        intelligence: { ...intelligenceOf(row), campaign_angle: 'Pain → Awareness → Trust' },
      }));
    expect(() => checkCampaignAngleTokenContract(badCandidate as never)).toThrow();

    // And one that introduces a deriveAngleType trigger word ('outcome').
    const triggerCandidate = (recs: Array<Record<string, unknown> & { topic: string }>, profile: never) =>
      currentNarrativeProducer(recs, profile).map((row) => ({
        ...row,
        intelligence: { ...intelligenceOf(row), campaign_angle: 'Pain → Outcome → Conversion' },
      }));
    expect(() => checkAngleClassificationContract(triggerCandidate as never)).toThrow();
  });
});
