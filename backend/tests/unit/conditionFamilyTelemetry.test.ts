/**
 * A degradation the user is told about must also be one the operator can count.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * PR #75 added a third degradation category, `family_unsupported`: an asset
 * family whose renderer never calls an image model, so an attached CONDITION
 * reference has no stage it could ever reach. It disclosed that correctly,
 * reusing the same three fields the image lane already ships.
 *
 * What it did not do was emit anything. The attempt was disclosed and
 * uncounted — outside `attempts = applied + degraded`, and carrying no
 * correlation id, so it could neither appear in the degradation rate nor be
 * traced back to the asset it produced. A person was told; nobody could measure
 * how often it happened, which is the exact gap Phase 86 existed to close for
 * the other two categories.
 *
 * Both the merged tree and PR #75's own suite were green, because those tests
 * assert the disclosure. Nothing asserted the counting.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const INFO = strip(read('../../services/creatorAssetRendererInfographic.ts'));
const IMAGE = strip(read('../../services/creatorAssetRendererImage.ts'));
const CONTRACTS = strip(read('../../services/creatorAssetRendererContracts.ts'));
const OBS = strip(read('../../services/creatorObservabilityService.ts'));

/** The family-unsupported block in the infographic renderer. */
const FAMILY = (() => {
  const start = INFO.indexOf('const degradation = unsupportedFamilyConditionDegradation(');
  return INFO.slice(start, INFO.indexOf('})(),', start) + 5);
})();
/** The provider-lane emit block in the image renderer. */
const PROVIDER = (() => {
  const start = IMAGE.indexOf('const conditionDegradation = providerResult.conditionDegradation');
  const applied = IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED');
  return IMAGE.slice(start, IMAGE.indexOf('});', applied) + 3);
})();

describe('A — a family-unsupported attempt is counted, not only disclosed', () => {
  it('CRITICAL: it emits the degraded event', () => {
    expect(FAMILY).toContain('emitCreatorEvent({');
    expect(FAMILY).toContain('event: CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED,');
  });

  it('CRITICAL: exactly one event — it must not also count as applied', () => {
    expect((INFO.match(/emitCreatorEvent\(/g) ?? [])).toHaveLength(1);
    // This renderer never calls a model, so it can never be an application.
    expect(INFO).not.toContain('CONDITION_REFERENCE_APPLIED');
    expect(INFO).not.toContain('conditionApplied');
  });

  it('CRITICAL: it carries the family category, not a provider one', () => {
    expect(FAMILY).toContain('category: degradation.category,');
    expect(CONTRACTS).toContain("category: 'family_unsupported',");
  });

  it('CRITICAL: nothing is emitted when no reference was attached', () => {
    // The constructor returns null for 0 attempted, and the guard returns early
    // — an ordinary infographic must not look like a degraded attempt.
    expect(FAMILY).toContain('if (!degradation) return {};');
    expect(CONTRACTS).toContain('if (attempted === 0) return null;');
  });
});

describe('B — the correlation id reaches this path too', () => {
  it('CRITICAL: an id is minted and stamped on the event', () => {
    expect(FAMILY).toContain('const conditionAttemptId = randomUUID();');
    expect(FAMILY).toContain('condition_attempt_id: conditionAttemptId,');
  });

  it('CRITICAL: the SAME id is stamped on the asset metadata', () => {
    expect(FAMILY).toContain('condition_attempt_id: conditionAttemptId,\n      };');
    expect((FAMILY.match(/randomUUID\(\)/g) ?? [])).toHaveLength(1);
    expect((FAMILY.match(/condition_attempt_id/g) ?? [])).toHaveLength(2);
  });

  it('the id is minted only inside the degradation branch', () => {
    expect(INFO).not.toMatch(/const conditionAttemptId = randomUUID\(\);[\s\S]{0,40}if \(!degradation\)/);
    expect((INFO.match(/randomUUID\(\)/g) ?? [])).toHaveLength(1);
  });
});

describe('C — the two emit sites carry the same dimensions', () => {
  it('CRITICAL: every dimension the provider lane reports, this one reports too', () => {
    for (const field of ['category:', 'references:', 'purpose:', 'mode:', 'composition_id:', 'condition_attempt_id:']) {
      expect(PROVIDER).toContain(field);
      expect(FAMILY).toContain(field);
    }
  });

  it('CRITICAL: purpose and mode come from the routed reference, not a URL', () => {
    expect(FAMILY).toContain('?.reference?.purpose ?? null,');
    expect(FAMILY).toContain('?.reference?.mode ?? null,');
    expect(FAMILY).not.toContain('sourceUrl');
  });

  it('references is a count, never the references themselves', () => {
    expect(FAMILY).toContain('references: routed.length,');
  });

  it('stage names the lane it came from', () => {
    // Same field, honest value: this did not happen at the provider.
    expect(FAMILY).toContain("stage: 'render_family',");
    expect(PROVIDER).toContain("stage: 'provider_edit'");
  });

  it('CRITICAL: latency is null, never a fabricated zero', () => {
    // No provider call was made. A 0 would drag the edit-latency percentiles
    // down with attempts that never reached a model.
    expect(FAMILY).toContain('latencyMs: null,');
    expect(FAMILY).not.toContain('latencyMs: 0');
  });

  it('CRITICAL: no forbidden field leaks', () => {
    for (const forbidden of ['sourceUrl', 'storagePath', 'storage_path', 'signedUrl',
      'bytes', 'buffer', 'fileName', 'prompt', 'stack', 'err.message']) {
      expect(FAMILY).not.toContain(forbidden);
    }
  });
});

describe('D — the denominator now includes all three categories', () => {
  it('CRITICAL: degraded is counted by event, so any category contributes', () => {
    // The rate counts the EVENT, not the category, which is what lets a third
    // category join the population without touching the arithmetic.
    expect(OBS).toContain('counts[CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED] ?? 0');
    expect(OBS).toContain('const conditionAttempts = conditionApplied + conditionDegraded;');
    expect(OBS).not.toContain('family_unsupported');
    expect(OBS).not.toContain('edit_failed');
  });

  it('all three categories exist and are closed', () => {
    const union = /export type ConditionDegradationCategory =([^;]+);/.exec(CONTRACTS);
    expect(union).not.toBeNull();
    const cats = union![1].split('|').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(cats).toEqual(['edit_failed', 'edit_no_image', 'family_unsupported']);
  });
});

describe('E — nothing else moved', () => {
  it('CRITICAL: the disclosure PR #75 shipped is unchanged', () => {
    expect(FAMILY).toContain('condition_reference_status: degradation.status,');
    expect(FAMILY).toContain('condition_reference_fallback_category: degradation.category,');
    expect(FAMILY).toContain('condition_reference_user_message: degradation.userMessage,');
  });

  it('CRITICAL: the user-facing copy is untouched', () => {
    expect(CONTRACTS).toContain('This design is built from your text and brand rather than generated from a photo');
    expect(CONTRACTS).not.toMatch(/family_unsupported[\s\S]{0,400}Regenerate to try again/);
  });

  it('CRITICAL: telemetry cannot fail the render', () => {
    // emitCreatorEvent is sync and never throws; it is not awaited here.
    expect(FAMILY).not.toContain('await emitCreatorEvent');
    expect(FAMILY).not.toContain('try {');
  });

  it('the provider lane is untouched by this change', () => {
    expect(PROVIDER).toContain('if (conditionDegradation || conditionApplied) {');
    expect(PROVIDER).toContain('emitCreatorEvent(conditionDegradation');
    expect(IMAGE).toContain('const conditionAttemptId = (conditionDegradation || conditionApplied) ? randomUUID() : null;');
  });

  it('CRITICAL: no billing call was ADDED, and none sits inside the telemetry branch', () => {
    /*
     * This renderer already records credits for its own render — that is
     * pre-existing and correct. The property under test is that adding
     * telemetry neither introduced a charge nor put one on a path that only
     * runs when a reference could not be applied.
     */
    expect((INFO.match(/recordAssetCredits\(/g) ?? [])).toHaveLength(1);
    expect((INFO.match(/captureImageProviderCost\(/g) ?? [])).toHaveLength(1);
    expect(FAMILY).not.toContain('recordAssetCredits');
    expect(FAMILY).not.toContain('captureImageProviderCost');
  });
});
