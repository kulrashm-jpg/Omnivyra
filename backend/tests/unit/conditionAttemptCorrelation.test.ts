/**
 * A count you cannot trace back is only half an answer.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Phase 86 made CONDITION attempts countable. It could not make them
 * *traceable*: the event fires in the renderer, where the composition context
 * lives, while the asset row does not exist until persistence — later, and in
 * another service. There was no asset id to put on the event, and the only
 * bridge was `trace_id`, which is ambient and therefore null exactly when an
 * investigation needs it.
 *
 * Phase 86 also left `provider_model` ambiguous on purpose: it reads
 * `gpt-image-1:edit` for both the canonical CONDITION path and the legacy
 * showcase edit path. Emitting the event only from the canonical branch settled
 * that for *counting*, but an event is not reachable from a row, so a historical
 * query over `creator_assets` still could not tell the two apart.
 *
 * This closes both with one id minted at the attempt and stamped on both sides,
 * plus one additive provenance flag. Nothing moves, nothing is duplicated, and
 * persistence never waits on telemetry.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const IMAGE = strip(read('../../services/creatorAssetRendererImage.ts'));
const MEDIA = strip(read('../../services/creatorAssetRendererMedia.ts'));
const TELEMETRY = strip(read('../../services/creatorOperationalTelemetryService.ts'));
const PERSIST = strip(read('../../services/creatorAssetPersistenceService.ts'));

/** The CONDITION emit block, bounded so assertions cannot drift into other code. */
const EMIT = (() => {
  const start = IMAGE.indexOf('const conditionDegradation = providerResult.conditionDegradation');
  const applied = IMAGE.indexOf('CREATOR_EVENTS.CONDITION_REFERENCE_APPLIED');
  // End at the close of the emit call, not a fixed offset. A window that runs
  // past it sweeps in ordinary render code and the leak assertions below stop
  // meaning anything.
  const end = IMAGE.indexOf('});', applied);
  return IMAGE.slice(start, end + 3);
})();
/** The asset metadata object that is returned and persisted. */
const ASSET_META = IMAGE.slice(
  IMAGE.indexOf('const modeAwareMetadata'),
  IMAGE.indexOf('image_subtype:'),
);

describe('A — the join key exists on both sides', () => {
  it('CRITICAL: one id is minted per attempt', () => {
    expect(IMAGE).toContain(
      'const conditionAttemptId = (conditionDegradation || conditionApplied) ? randomUUID() : null;',
    );
    expect((IMAGE.match(/randomUUID\(\)/g) ?? [])).toHaveLength(1);
  });

  it('CRITICAL: it rides on the event', () => {
    expect(EMIT).toContain('condition_attempt_id: conditionAttemptId,');
  });

  it('CRITICAL: it rides on the persisted asset', () => {
    expect(ASSET_META).toContain('condition_attempt_id: conditionAttemptId ?? undefined,');
  });

  it('CRITICAL: both sides use the SAME variable — not two independent ids', () => {
    // Two mints would produce two ids that never join.
    expect((IMAGE.match(/const conditionAttemptId/g) ?? [])).toHaveLength(1);
    expect((IMAGE.match(/condition_attempt_id/g) ?? [])).toHaveLength(2);
  });

  it('an ordinary generation carries no key on either side', () => {
    // Null on the event side, absent on the asset side — an unattempted render
    // must not look like an attempt that produced nothing.
    expect(IMAGE).toContain('? randomUUID() : null;');
    expect(ASSET_META).toContain('conditionAttemptId ?? undefined,');
  });
});

describe('B — canonical CONDITION is now distinguishable in the asset row', () => {
  it('CRITICAL: the provenance flag is set only when the canonical edit applied', () => {
    expect(ASSET_META).toContain('condition_reference_applied: conditionApplied || undefined,');
  });

  it('CRITICAL: it derives from the canonical-only signal', () => {
    expect(IMAGE).toContain('const conditionApplied = providerResult.conditionApplied === true;');
    // Set in exactly one place in the provider wrapper: the canonical branch.
    const canonical = MEDIA.slice(
      MEDIA.indexOf('if (canonicalRefs.length > 0)'),
      MEDIA.indexOf('if (referenceModeEnabled && typeof referenceUrl'),
    );
    expect((canonical.match(/conditionApplied: true/g) ?? [])).toHaveLength(2);
  });

  it('CRITICAL: the showcase edit path cannot set it', () => {
    const showcase = MEDIA.slice(
      MEDIA.indexOf('if (referenceModeEnabled && typeof referenceUrl'),
      MEDIA.indexOf('for (const model of modelCandidates)'),
    );
    expect(showcase).toContain(':edit`');            // still an edit path…
    expect(showcase).not.toContain('conditionApplied'); // …but never canonical
  });

  it('CRITICAL: provider_model is untouched', () => {
    // Exactly one occurrence, and it is the original expression — no rewrite,
    // no discriminator smuggled into it.
    expect((IMAGE.match(/provider_model:/g) ?? [])).toHaveLength(1);
    expect(IMAGE).toContain('provider_model: providerImage?.model,');
  });

  it('absence keeps every other path and every existing row unchanged', () => {
    // `|| undefined` omits the key entirely rather than writing `false`.
    expect(ASSET_META).not.toContain('condition_reference_applied: false');
    expect(ASSET_META).not.toContain('condition_reference_applied: conditionApplied,');
  });
});

describe('C — Phase 76 disclosure is untouched', () => {
  it('CRITICAL: the triple is unchanged', () => {
    expect(ASSET_META).toContain('condition_reference_status: conditionDegradation?.status,');
    expect(ASSET_META).toContain('condition_reference_fallback_category: conditionDegradation?.category,');
    expect(ASSET_META).toContain('condition_reference_user_message: conditionDegradation?.userMessage,');
  });

  it('CRITICAL: a successful CONDITION is still visually UNMARKED', () => {
    // The banner keys solely on `_status`. The new fields must not give a
    // working result something a client could render as a warning.
    expect(ASSET_META).not.toMatch(/condition_reference_status:\s*'applied'/);
    expect(ASSET_META).not.toMatch(/condition_reference_status:.*conditionApplied/);
  });

  it('the client still reads only the status field', () => {
    const page = strip(read('../../../pages/command-center/creator-content/[type].tsx'));
    expect(page).toContain('previewMetadata.condition_reference_status');
    expect(page).not.toContain('condition_attempt_id');
    expect(page).not.toContain('condition_reference_applied');
  });
});

describe('D — telemetry still gates nothing', () => {
  it('CRITICAL: the emitter is fire-and-forget', () => {
    expect(TELEMETRY).toContain('export function emitCreatorEvent');
    expect(TELEMETRY).not.toContain('export async function emitCreatorEvent');
    expect(EMIT).not.toContain('await emitCreatorEvent');
  });

  it('CRITICAL: minting the id cannot throw the render', () => {
    // randomUUID is synchronous and total; no I/O, no await, no fallible call.
    expect(IMAGE).not.toContain('await randomUUID');
    expect(IMAGE).not.toMatch(/try\s*\{[^}]*randomUUID/);
  });

  it('CRITICAL: persistence does not depend on the event or the id', () => {
    expect(PERSIST).not.toContain('condition_attempt_id');
    expect(PERSIST).not.toContain('emitCreatorEvent');
    // Not just the call — the dependency. A coupling introduced by importing
    // the telemetry module (statically or dynamically) would let a telemetry
    // failure surface on the write path, which is the thing being prevented.
    expect(PERSIST).not.toContain('creatorOperationalTelemetryService');
    expect(PERSIST).not.toMatch(/import\([^)]*[Tt]elemetry/);
  });

  it('CRITICAL: billing is unchanged and not gated on telemetry', () => {
    expect((MEDIA.match(/recordAssetCredits\(/g) ?? [])).toHaveLength(3);
    expect((MEDIA.match(/captureImageProviderCost\(/g) ?? [])).toHaveLength(2);
    const canonical = MEDIA.slice(
      MEDIA.indexOf('if (canonicalRefs.length > 0)'),
      MEDIA.indexOf('if (referenceModeEnabled && typeof referenceUrl'),
    );
    expect(canonical.indexOf('recordAssetCredits'))
      .toBeLessThan(canonical.indexOf('conditionApplied: true'));
  });
});

describe('E — event semantics and payload are preserved', () => {
  it('CRITICAL: still exactly one event per outcome, and no third event', () => {
    expect((IMAGE.match(/CREATOR_EVENTS\.CONDITION_REFERENCE_APPLIED/g) ?? [])).toHaveLength(1);
    expect((IMAGE.match(/CREATOR_EVENTS\.CONDITION_REFERENCE_DEGRADED/g) ?? [])).toHaveLength(1);
    expect((IMAGE.match(/emitCreatorEvent\(/g) ?? [])).toHaveLength(1);
  });

  it('CRITICAL: every prior dimension survives', () => {
    for (const f of ["stage: 'provider_edit'", 'references: routed.length,',
      'purpose: routed[0]?.reference?.purpose ?? null,', 'mode: routed[0]?.reference?.mode ?? null,',
      'composition_id: conditionPlan?.compositionId ?? null,']) {
      expect(EMIT).toContain(f);
    }
    expect(EMIT).toContain('latencyMs,');
    expect(EMIT).toContain('companyId: options.companyId ?? null,');
  });

  it('CRITICAL: no forbidden field leaked onto either event', () => {
    for (const forbidden of ['sourceUrl', 'storagePath', 'storage_path', 'signedUrl', 'file_url',
      'bytes', 'buffer', 'fileName', 'filename', 'prompt', 'fallbackReason', 'stack',
      'err.message', 'error.message']) {
      expect(EMIT).not.toContain(forbidden);
    }
  });

  it('the id is opaque — it encodes nothing about the asset or its storage', () => {
    expect(IMAGE).toContain('randomUUID()');
    expect(IMAGE).not.toMatch(/conditionAttemptId\s*=\s*createHash/);
    expect(IMAGE).not.toMatch(/conditionAttemptId\s*=\s*`/);
  });
});

describe('F — Phase 74/78 lifecycle is untouched', () => {
  it('deletion still projects every object-bearing column', () => {
    // Anchored to the DELETE chain. A bare substring passes on the sharer
    // scan's identical projection, so it would not notice the delete narrowing
    // back to `url` — the exact Phase 78 defect.
    expect(PERSIST).toContain(
      "    .delete()\n" +
      "    .eq('id', input.assetId)\n" +
      "    .eq('company_id', input.companyId)\n" +
      "    .select('id, url, files, metadata');",
    );
    expect(PERSIST).toContain('await removeRenderedObjectsForDeletedAsset(');
  });

  it('CRITICAL: deleting an asset does not reach into telemetry', () => {
    // Events are historical and must outlive the assets they describe, which is
    // also why the join key lives in metadata rather than a foreign key.
    expect(PERSIST).not.toContain('creator_operational_events');
  });

  it('no migration was introduced — both sides are existing JSONB', () => {
    expect(TELEMETRY).toContain('metadata: input.metadata ?? {},');
    expect(PERSIST).toContain('metadata: baseMetadata,');
  });
});
