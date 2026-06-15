/**
 * Phase 1 — Intelligent Mix (combined) mixed-lane activation (G1/G2).
 *
 * Intelligent Mix reuses the existing first-class `combined` campaign mode.
 * This is a DECISION/CONTRACT lock for the two flags introduced in
 * backend/services/boltPipelineService.ts:
 *
 *   runsCreatorGeneration   = usesUnifiedMediaFlow || isCombined
 *   preserveCreatorBlueprint = requiresMediaFlow   || isCombined
 *
 * where (all derived from executionProfile = getExecutionProfile(config)):
 *   usesUnifiedMediaFlow = profile === 'creator'
 *   usesLegacyMediaFlow  = isLegacyMediaProfile(profile)  // 'creator_dependent'
 *   requiresMediaFlow    = usesUnifiedMediaFlow || usesLegacyMediaFlow
 *   isCombined           = profile === 'combined'
 *
 * The test reproduces that truth table from the SAME source primitives the
 * pipeline uses (getExecutionProfile / isLegacyMediaProfile), so the gating
 * intent is locked:
 *   - text         → no blueprint preservation, no creator generation  (UNCHANGED)
 *   - creator      → preserve + generate                               (UNCHANGED)
 *   - creator_dependent (legacy) → preserve, NO new-runtime generation (UNCHANGED)
 *   - combined (Intelligent Mix) → preserve (G1) + generate (G2)       (NEW)
 *
 * Scheduler routing keys off usesUnifiedMediaFlow (=== 'creator') and is
 * therefore intentionally UNCHANGED for combined — verified below.
 */

import { getExecutionProfile, isLegacyMediaProfile } from '../../../variants/bolt/boltCampaignMetadata';

/** Mirror of the boltPipelineService.ts Phase-1 flag derivation. */
function deriveFlags(config: unknown) {
  const executionProfile = getExecutionProfile(config);
  const usesUnifiedMediaFlow = executionProfile === 'creator';
  const usesLegacyMediaFlow = isLegacyMediaProfile(executionProfile);
  const requiresMediaFlow = usesUnifiedMediaFlow || usesLegacyMediaFlow;
  const isCombined = executionProfile === 'combined';
  return {
    executionProfile,
    usesUnifiedMediaFlow,
    requiresMediaFlow,
    isCombined,
    runsCreatorGeneration: usesUnifiedMediaFlow || isCombined,
    preserveCreatorBlueprint: requiresMediaFlow || isCombined,
  };
}

// boltCampaignMetadata stores campaign_mode under an obfuscated key.
function configForMode(mode: string) {
  return { campaign_mode: mode };
}

describe('Intelligent Mix (combined) mixed-lane gating — Phase 1 (G1/G2)', () => {
  test('text mode: UNCHANGED — sanitised blueprint, no creator generation', () => {
    const f = deriveFlags(configForMode('text'));
    expect(f.preserveCreatorBlueprint).toBe(false); // → sanitizeBoltPlanForTextOnly runs
    expect(f.runsCreatorGeneration).toBe(false);     // → creator-asset stage skipped
    expect(f.usesUnifiedMediaFlow).toBe(false);       // → text scheduling lane
  });

  test('missing campaign_mode defaults to text: UNCHANGED', () => {
    const f = deriveFlags({});
    expect(f.executionProfile).toBe('text');
    expect(f.preserveCreatorBlueprint).toBe(false);
    expect(f.runsCreatorGeneration).toBe(false);
  });

  test('creator mode: UNCHANGED — preserve blueprint + run creator generation', () => {
    const f = deriveFlags(configForMode('creator'));
    expect(f.preserveCreatorBlueprint).toBe(true);
    expect(f.runsCreatorGeneration).toBe(true);
    expect(f.usesUnifiedMediaFlow).toBe(true); // creator scheduling lane unchanged
  });

  test('legacy creator_dependent mode: UNCHANGED — preserve blueprint, NOT the new creator runtime', () => {
    const f = deriveFlags(configForMode('creator_dependent'));
    expect(f.requiresMediaFlow).toBe(true);
    expect(f.preserveCreatorBlueprint).toBe(true);
    // Legacy media flow keeps its own path; the new creator-asset runtime
    // is gated on usesUnifiedMediaFlow||isCombined, so it must stay OFF here.
    expect(f.runsCreatorGeneration).toBe(false);
    expect(f.usesUnifiedMediaFlow).toBe(false);
  });

  test('combined (Intelligent Mix): NEW — preserve blueprint (G1) + run creator generation (G2)', () => {
    const f = deriveFlags(configForMode('combined'));
    expect(f.isCombined).toBe(true);
    expect(f.preserveCreatorBlueprint).toBe(true); // G1: creator/video formats survive commit
    expect(f.runsCreatorGeneration).toBe(true);    // G2: creator-asset stage runs
    // Phase-1 boundary: scheduler routing is UNCHANGED for combined because
    // usesUnifiedMediaFlow stays === 'creator'. Per-row routing is Phase 2.
    expect(f.usesUnifiedMediaFlow).toBe(false);
  });
});
