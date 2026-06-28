/**
 * BlueprintPromptAssembler (CREATOR-060) — the ONE place that translates a
 * visual blueprint into AI visual instructions. No other module builds blueprint
 * prompt fragments; callers consume `assembleBlueprintPrompt` / the enrich helpers.
 *
 * It REUSES existing derivation (no duplicate logic): field extraction comes from
 * the runtime bridge, descriptive vocabulary from the blueprint preview. It only
 * composes them into a prompt string, in the canonical priority order.
 *
 * Priority (CREATOR-060 STEP 4): the CALLER's base prompt carries business goal /
 * brand / audience FIRST; the blueprint string is appended to ENRICH visual intent
 * and never overrides business intent. Within the blueprint string the order is
 * style → subject → composition/framing → camera → lighting → typography →
 * colour → brand behaviour → layout → vocabulary.
 *
 * Additive + deterministic: no blueprint ⇒ helpers return the base string
 * unchanged (byte-identical), so legacy generation is untouched.
 */

import { resolveBlueprintRuntime } from '../../../../lib/creator-outcomes/blueprintRuntimeBridge';
import { getBlueprintPreview } from '../../../../lib/creator-outcomes/blueprintPreview';

export interface BlueprintPrompt {
  blueprintId: string;
  visualCategory: string;
  /** Deterministic visual vocabulary for this blueprint (e.g. "spray paint, urban walls"). */
  visualVocabulary: string;
  /** The full assembled blueprint visual instruction, priority-ordered. */
  directives: string;
}

/** Assemble the canonical blueprint visual instruction (null when no blueprint). */
export function assembleBlueprintPrompt(blueprintId: string | null | undefined): BlueprintPrompt | null {
  const rt = resolveBlueprintRuntime(blueprintId);
  if (!rt) return null;
  const pv = getBlueprintPreview(rt.blueprintId);
  const vocabulary = (pv?.visualKeywords ?? []).map((s) => s.trim()).filter(Boolean).join(', ');

  const ordered = [
    rt.stylePrompt,                                                                          // style
    rt.imagePrompt,                                                                          // subject / imagery
    pv?.compositionNotes,                                                                    // composition / framing
    pv?.cameraStyle,                                                                         // camera language
    pv?.lighting,                                                                            // lighting
    rt.typographyGuidance,                                                                   // typography
    `colour palette ${rt.colorLanguage.primary} with ${rt.colorLanguage.surface}, ${rt.colorLanguage.contrast} contrast`, // colour language
    rt.brandBehavior,                                                                        // brand behaviour
    rt.layoutGuidance,                                                                       // layout
    vocabulary ? `visual vocabulary: ${vocabulary}` : '',                                    // deterministic vocabulary
  ].map((s) => (s ?? '').toString().trim()).filter(Boolean);

  return { blueprintId: rt.blueprintId, visualCategory: rt.visualCategory, visualVocabulary: vocabulary, directives: ordered.join('. ') };
}

/**
 * Append blueprint visual instructions to a base prompt (business intent stays
 * first). Returns `base` unchanged when there is no blueprint — byte-identical.
 */
export function enrichVisualPrompt(base: string, blueprintId: string | null | undefined): string {
  const bp = assembleBlueprintPrompt(blueprintId);
  if (!bp) return base;
  const head = (base ?? '').trim();
  return head ? `${head}. ${bp.directives}` : bp.directives;
}
