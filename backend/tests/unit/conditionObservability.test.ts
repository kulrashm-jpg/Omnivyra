/**
 * CONDITION has to be countable, not just disclosable.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Phase 76 made a failed CONDITION attempt visible: it emits
 * `CONDITION_REFERENCE_DEGRADED` and marks the asset. What it could not do is
 * answer "how often does this happen?", because failures were counted against
 * nothing. Success had NO representation at all — an applied reference and an
 * ordinary generation produced the identical shape.
 *
 * `provider_model` could not stand in for the denominator: the legacy showcase
 * edit path stamps the same `…:edit` string, so counting those would fold two
 * different operations together. `creator_assets` could not either — Phase
 * 74/78 deletion removes assets while the events correctly survive them.
 *
 * So the denominator is the event pair, and only the event pair:
 *
 *     attempts = applied + degraded
 *
 * These tests pin that arithmetic, the emission boundaries that make `applied`
 * mean *canonical* CONDITION, and the safety rules the payload inherits from
 * Phase 76 — which now have to hold on two events instead of one.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const IMAGE = strip(read('../../services/creatorAssetRendererImage.ts'));
const MEDIA = strip(read('../../services/creatorAssetRendererMedia.ts'));
const CONTRACTS = strip(read('../../services/creatorAssetRendererContracts.ts'));
const TELEMETRY = strip(read('../../services/creatorOperationalTelemetryService.ts'));
const OBS = strip(read('../../services/creatorObservabilityService.ts'));
const RESOLUTION = strip(read('../../services/compositionAssetResolutionService.ts'));
const TAB = strip(read('../../../components/super-admin/tabs/CreatorOperationsTab.tsx'));

/** The canonical branch: from `if (canonicalRefs.length > 0)` to the showcase branch. */
const CANONICAL = MEDIA.slice(
  MEDIA.indexOf('if (canonicalRefs.length > 0)'),
  MEDIA.indexOf('if (referenceModeEnabled && typeof referenceUrl'),
);
/** The legacy showcase branch, which must never claim to be CONDITION. */
const SHOWCASE = MEDIA.slice(
  MEDIA.indexOf('if (referenceModeEnabled && typeof referenceUrl'),
  MEDIA.indexOf('for (const model of modelCandidates)'),
);
/** The plain generation loop — neither CONDITION nor showcase. */
const PLAIN = MEDIA.slice(MEDIA.indexOf('for (const model of modelCandidates)'));

/* ── A/E/F — the success event means CANONICAL condition ──────────────────── */

describe('A — a successful CONDITION application is recorded exactly once', () => {
  it('CRITICAL: the event exists and is emitted from exactly one place', () => {
    expect(TELEMETRY).toContain("CONDITION_REFERENCE_APPLIED: 'condition_reference_applied',");
    expect((IMAGE.match(/CREATOR_EVENTS\.CONDITION_REFERENCE_APPLIED/g) ?? [])).toHaveLength(1);
  });

  it('CRITICAL: it fires only when the provider reported an applied reference', () => {
    expect(IMAGE).toContain('const conditionApplied = providerResult.conditionApplied === true;');
    // Strict `=== true`: a truthy-but-not-true value must not count an attempt.
    expect(IMAGE).not.toMatch(/conditionApplied\s*=\s*providerResult\.conditionApplied;/);
  });

  it('CRITICAL: degradation wins — a degraded attempt is never counted as applied', () => {
    expect(IMAGE).toContain('emitCreatorEvent(conditionDegradation');
    const guard = IMAGE.slice(IMAGE.indexOf('emitCreatorEvent(conditionDegradation'));
    expect(guard.indexOf('CONDITION_REFERENCE_DEGRADED'))
      .toBeLessThan(guard.indexOf('CONDITION_REFERENCE_APPLIED'));
  });
});

describe('E/F — only the canonical branch can produce an applied attempt', () => {
  it('CRITICAL: the canonical branch sets conditionApplied', () => {
    expect(CANONICAL).toContain('conditionApplied: true,');
  });

  it('CRITICAL: the showcase edit branch NEVER sets it', () => {
    // Both stamp `…:edit`, so the model string cannot separate them. Emission
    // origin is the only thing that can.
    expect(SHOWCASE).toContain(':edit`');           // it is still an edit path
    expect(SHOWCASE).not.toContain('conditionApplied');
  });

  it('CRITICAL: plain generation (and COMPOSE, which never reaches a provider edit) sets it nowhere', () => {
    expect(PLAIN).not.toContain('conditionApplied');
    // Twice, and only twice: the canonical branch returns from two places (a
    // base64 payload and a remote URL). Both are inside it; nowhere else sets it.
    expect((MEDIA.match(/conditionApplied: true/g) ?? [])).toHaveLength(2);
    expect((CANONICAL.match(/conditionApplied: true/g) ?? [])).toHaveLength(2);
  });

  it('COMPOSE cannot reach this code — it is a separate plan that never calls a provider', () => {
    expect(RESOLUTION).toContain('composePlan');
    const compose = RESOLUTION.slice(RESOLUTION.indexOf('composePlan: {'), RESOLUTION.indexOf('conditionPlan: {'));
    expect(compose).not.toContain('images.edit');
  });
});

/* ── B/C/D — failure and non-attempt ──────────────────────────────────────── */

describe('B/C — both degradation causes still emit, unchanged', () => {
  it('CRITICAL: a thrown edit is edit_failed', () => {
    expect(CANONICAL).toContain("conditionDegradation = degradedBy('edit_failed');");
  });

  it('CRITICAL: an edit returning no usable image is edit_no_image', () => {
    expect(CANONICAL).toContain("conditionDegradation = degradedBy('edit_no_image');");
  });

  it('the two PROVIDER causes remain the only provider causes', () => {
    /*
     * This pinned the whole union when every cause was a provider outcome.
     * Phase 61E added `family_unsupported`, which is not one: it says the asset
     * family has no stage that could consume a reference, so no call was ever
     * made and no provider could have failed.
     *
     * What this suite is guarding is unchanged — that measurement work added no
     * new way for the PROVIDER to fail. So it now asserts exactly that: the
     * provider causes are still the two, and the only other member is the
     * non-provider one, named explicitly so a genuine third provider cause
     * still has to be deliberate.
     */
    const union = /export type ConditionDegradationCategory =([^;]+);/.exec(CONTRACTS);
    expect(union).not.toBeNull();
    const categories = union![1].split('|').map((s) => s.trim().replace(/'/g, ''));
    const providerCauses = categories.filter((c) => c.startsWith('edit_'));
    expect(providerCauses.sort()).toEqual(['edit_failed', 'edit_no_image']);
    expect(categories.filter((c) => !c.startsWith('edit_'))).toEqual(['family_unsupported']);
  });
});

describe('D — an ordinary generation emits neither event', () => {
  it('CRITICAL: the guard requires one outcome or the other', () => {
    expect(IMAGE).toContain('if (conditionDegradation || conditionApplied) {');
  });

  it('CRITICAL: with no attempt, both signals are absent and nothing is emitted', () => {
    // `conditionDegradation` null and `conditionApplied` not true is exactly the
    // ordinary-generation case; the guard is the only thing standing between it
    // and a fabricated attempt.
    expect(IMAGE).toContain('const conditionDegradation = providerResult.conditionDegradation ?? null;');
    expect(MEDIA).toContain('let conditionLatencyMs: number | null = null;');
  });
});

/* ── G/H/I — payload safety, on BOTH events ───────────────────────────────── */

describe('G/H — both events carry the same safe dimensions', () => {
  it('CRITICAL: one metadata object serves both, so they cannot drift', () => {
    expect(IMAGE).toContain('const metadata = {');
    const block = IMAGE.slice(IMAGE.indexOf('const metadata = {'), IMAGE.indexOf('const latencyMs ='));
    for (const field of ["stage: 'provider_edit'", 'references:', 'purpose:', 'mode:', 'composition_id:']) {
      expect(block).toContain(field);
    }
  });

  it('CRITICAL: purpose and mode come from the routed reference, not a URL', () => {
    expect(IMAGE).toContain('purpose: routed[0]?.reference?.purpose ?? null,');
    expect(IMAGE).toContain('mode: routed[0]?.reference?.mode ?? null,');
  });

  it('category rides only on the degraded event', () => {
    expect(IMAGE).toContain('metadata: { ...metadata, category: conditionDegradation.category },');
  });

  it('the applied event is info, the degraded one warning', () => {
    const applied = IMAGE.slice(IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED') - 200,
      IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED') + 200);
    expect(applied).toContain("severity: 'info'");
    const degraded = IMAGE.slice(IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED') - 200,
      IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED') + 200);
    expect(degraded).toContain("severity: 'warning'");
  });
});

describe('I — nothing sensitive enters telemetry', () => {
  it('CRITICAL: no URL, path, bytes, filename, prompt or provider text on either event', () => {
    // Bounded to the emit block itself — a wider window would sweep in
    // unrelated render code and the assertion would stop meaning anything.
    const block = IMAGE.slice(
      IMAGE.indexOf('if (conditionDegradation || conditionApplied) {'),
      IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED') + 200,
    );
    for (const forbidden of [
      'sourceUrl', 'storagePath', 'storage_path', 'signedUrl', 'file_url',
      'bytes', 'buffer', 'fileName', 'filename', 'prompt', 'fallbackReason',
      'err.message', 'error.message', 'stack',
    ]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it('CRITICAL: references is a COUNT, never the references themselves', () => {
    expect(IMAGE).toContain('references: routed.length,');
  });
});

/* ── J — correlation ──────────────────────────────────────────────────────── */

describe('J — composition_id is carried when it exists', () => {
  it('CRITICAL: the condition plan carries the composition id', () => {
    expect(RESOLUTION).toContain('compositionId: string;');
    expect(RESOLUTION).toContain('compositionId: input.compositionId,');
  });

  it('CRITICAL: the event reads it from the plan', () => {
    expect(IMAGE).toContain('composition_id: conditionPlan?.compositionId ?? null,');
  });

  it('absent means null — never an invented value', () => {
    expect(IMAGE).not.toMatch(/composition_id:\s*['"`]/);
    expect(IMAGE).not.toContain("composition_id: 'unknown'");
  });

  it('company scoping is unchanged', () => {
    expect((IMAGE.match(/companyId: options\.companyId \?\? null,/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ── K — durable latency ──────────────────────────────────────────────────── */

describe('K — provider latency is durable and belongs to the edit call', () => {
  it('CRITICAL: it rides on the event row, not the in-memory metric', () => {
    expect(IMAGE).toContain('latencyMs,');
    expect(TELEMETRY).toContain('latency_ms: input.latencyMs ?? null,');
  });

  it('CRITICAL: applied and degraded both carry it, from one computation', () => {
    expect((IMAGE.match(/^\s+latencyMs,$/gm) ?? [])).toHaveLength(2);
    expect((IMAGE.match(/const latencyMs =/g) ?? [])).toHaveLength(1);
  });

  it('CRITICAL: measured at the provider boundary in the canonical branch', () => {
    expect(CANONICAL).toContain('const conditionLatencyMs = Date.now() - editStartedAt;');
    expect(CANONICAL).toContain('conditionLatencyMs = Date.now() - editStartedAt;');
  });

  it('CRITICAL: never fabricated — a missing latency stays null, not 0', () => {
    expect(IMAGE).toContain("typeof providerResult.conditionLatencyMs === 'number'");
    expect(IMAGE).not.toMatch(/conditionLatencyMs\s*\?\?\s*0/);
    expect(MEDIA).toContain('let conditionLatencyMs: number | null = null;');
  });

  it('recordCreatorDuration is NOT repurposed for this', () => {
    // It is per-process and restart-lossy; the durable column is the vehicle.
    // Scoped to the emit block — the metric legitimately exists elsewhere.
    const block = IMAGE.slice(
      IMAGE.indexOf('if (conditionDegradation || conditionApplied) {'),
      IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED') + 200,
    );
    expect(block).not.toContain('recordCreatorDuration');
  });
});

/* ── L/M/N — the arithmetic ───────────────────────────────────────────────── */

describe('L/M/N — attempts, rate, and the empty window', () => {
  it('CRITICAL: attempts = applied + degraded', () => {
    expect(OBS).toContain('const conditionAttempts = conditionApplied + conditionDegraded;');
  });

  it('CRITICAL: the denominator comes from events only', () => {
    expect(OBS).toContain('counts[CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED] ?? 0');
    expect(OBS).toContain('counts[CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED] ?? 0');
    // Never from the asset table, the model string, or the in-memory metric.
    expect(OBS).not.toContain('provider_model');
    expect(OBS).not.toContain('creator_assets');
    expect(OBS).not.toContain('getCreatorRuntimeMetricsSnapshot');
  });

  it('CRITICAL: the rate is degraded / attempts, in that order', () => {
    expect(OBS).toContain('const condition_degradation = neutralRatio(conditionDegraded, conditionAttempts, 0);');
    // Inverted would be applied/attempts or attempts/degraded.
    expect(OBS).not.toContain('neutralRatio(conditionApplied, conditionAttempts');
    expect(OBS).not.toContain('neutralRatio(conditionAttempts, conditionDegraded');
  });

  it('CRITICAL: zero attempts cannot divide by zero', () => {
    // neutralRatio short-circuits on denom <= 0 — reused rather than reinvented.
    expect(OBS).toContain('denom <= 0 ? bestCase : safeRatio(num, denom)');
  });

  it('all four figures are published, counts as counts', () => {
    for (const f of ['condition_attempts: conditionAttempts,', 'condition_applied: conditionApplied,',
      'condition_degraded: conditionDegraded,', 'condition_degradation,']) {
      expect(OBS).toContain(f);
    }
  });

  it('every pre-existing rate survives', () => {
    for (const r of ['upload_success', 'upload_failure', 'resumable_recovery', 'queue_contention',
      'publish_validation_failure', 'orphan_cleanup_rate', 'upload_retry_per_hour',
      'attachment_readiness_conversion']) {
      expect(OBS).toContain(r);
    }
  });
});

/* ── Operations surface ───────────────────────────────────────────────────── */

describe('The operator can actually see it', () => {
  it('CRITICAL: all four figures are rendered', () => {
    expect(TAB).toContain('condition_attempts');
    expect(TAB).toContain('condition_applied');
    expect(TAB).toContain('condition_degraded');
    expect(TAB).toContain('condition_degradation');
  });

  it('an empty window reads as "no attempts", not as a healthy 0%', () => {
    expect(TAB).toContain('No attempts in this window');
  });

  it('no second endpoint was introduced', () => {
    expect(TAB).toContain('data.snapshot.rates');
    expect((TAB.match(/fetch\(/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

/* ── O/P + billing + lifecycle: untouched neighbours ──────────────────────── */

describe('O — Phase 76 disclosure is unchanged', () => {
  it('the triple still reaches the asset metadata', () => {
    expect(IMAGE).toContain('condition_reference_status: conditionDegradation?.status,');
    expect(IMAGE).toContain('condition_reference_fallback_category: conditionDegradation?.category,');
    expect(IMAGE).toContain('condition_reference_user_message: conditionDegradation?.userMessage,');
  });

  it('CRITICAL: a successful CONDITION stays UNMARKED on the asset', () => {
    // The new event records the success; the asset must not gain a marker,
    // or the client would render a disclosure banner for a working result.
    expect(IMAGE).not.toMatch(/condition_reference_status:\s*'applied'/);
    expect(IMAGE).not.toContain('conditionApplied ? ');
  });

  it('the user-facing sentence is untouched and carries no provider text', () => {
    expect(MEDIA).toContain('Your reference image could not be applied');
  });
});

describe('Billing, lifecycle and the gate are untouched', () => {
  it('CRITICAL: telemetry adds no charge — credit calls are unchanged in count', () => {
    expect((MEDIA.match(/recordAssetCredits\(/g) ?? [])).toHaveLength(3);
    expect((MEDIA.match(/captureImageProviderCost\(/g) ?? [])).toHaveLength(2);
  });

  it('CRITICAL: credits are recorded before the telemetry field, not gated on it', () => {
    expect(CANONICAL.indexOf('recordAssetCredits'))
      .toBeLessThan(CANONICAL.indexOf('conditionApplied: true'));
  });

  it('the CONDITION gate and its fallback are unchanged', () => {
    const multimodal = strip(read('../../services/creator/creatorMultimodalReferences.ts'));
    expect(multimodal).toContain("process.env.CREATOR_IMAGE_REFERENCE_MODE === 'edit'");
    expect(multimodal).toContain("? 'edit' : 'generate'");
  });

  it('Phase 74/78 lifecycle deletion is untouched, and events outlive assets', () => {
    const persistence = strip(read('../../services/creatorAssetPersistenceService.ts'));
    expect(persistence).toContain('await removeRenderedObjectsForDeletedAsset(');
    expect(persistence).toContain(".select('id, url, files, metadata')");
    // Deletion must never reach into the telemetry table.
    expect(persistence).not.toContain('creator_operational_events');
  });

  it('no alerting policy was introduced', () => {
    const alerting = strip(read('../../services/creatorAlertingService.ts'));
    expect(alerting).not.toContain('condition_reference');
  });

  it('telemetry stays best-effort — a failed emit cannot fail a render', () => {
    // Asserted against the CODE, not a comment (TELEMETRY is comment-stripped):
    // the emitter swallows its own failures rather than propagating them.
    expect(TELEMETRY).toContain('export function emitCreatorEvent');
    expect(TELEMETRY).toContain('catch (err) {');
    expect(TELEMETRY).not.toContain('export async function emitCreatorEvent');
    const emitBlock = IMAGE.slice(
      IMAGE.indexOf('if (conditionDegradation || conditionApplied) {'),
      IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED') + 200,
    );
    expect(emitBlock).not.toContain('await emitCreatorEvent');
  });
});
