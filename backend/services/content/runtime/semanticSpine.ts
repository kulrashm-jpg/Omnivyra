/**
 * WS-1a (PMO-ADR-06) — the Semantic Spine builder + derivations.
 *
 * THE single place a Semantic Root is constructed and the single place the
 * visual bridge is derived. Pure + deterministic (aside from the one id/clock
 * seam used to mint a root); NO I/O, NO AI calls, NO image calls, NO DB writes.
 *
 * DESIGN
 *  - `buildSemanticRoot(ctx)` derives the immutable identity from the ALREADY
 *    resolved GenerationContext, using the exact same field precedence the
 *    generation primitives use today (objective → communication intent;
 *    outcome_promise / pain_point / brief.whatProblemAreWeAddressing → core
 *    message). Because it reads the same inputs, the derived values match what
 *    the prompt would have used anyway — continuity without behavior drift.
 *  - The constructed root is Object.freeze()d: no downstream stage can mutate
 *    the shared communication objective.
 *  - `deriveVisualBrief` / `deriveImagePromptSpec` are the ORCHESTRATION-ONLY
 *    visual bridge. They carry the semantic lineage toward the (frozen) image
 *    seam; they never call it.
 *  - `buildSemanticContinuity` produces the lineage record whose
 *    `generationLineageRef` is a SOFT reference into the existing
 *    `publication_lineage` store (Wave 5) — no second lineage store.
 *
 * FLAG — `isSemanticRootEnabled()` reads `SEMANTIC_ROOT_ENABLED` (default OFF).
 * With the flag OFF the runtime never calls into this module, so behavior is
 * byte-identical to pre-WS-1a.
 */

import type {
  GenerationContext,
  ImagePromptSpec,
  SemanticContentBrief,
  SemanticContinuity,
  SemanticRoot,
  VisualBrief,
} from './contracts';
import {
  deriveSemanticRootId,
  newGenerationInstanceId,
  normalizeCommunicationIntent,
} from '../../../platform/intelligence';

/** WS-1a flag — default OFF. `1/true/on/yes` opts a call into the Semantic Spine. */
export function isSemanticRootEnabled(): boolean {
  return /^(1|true|on|yes)$/.test(
    String(process.env.SEMANTIC_ROOT_ENABLED ?? '').trim().toLowerCase(),
  );
}

function trimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function briefField(brief: Record<string, unknown> | undefined, key: string): string {
  if (!brief) return '';
  return trimmed(brief[key]);
}

function excerpt(text: string, max: number): string {
  const t = trimmed(text);
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

/**
 * Build the immutable Semantic Root from a resolved GenerationContext.
 *
 * Field precedence for `topic` and `communicationIntent` EXACTLY mirrors
 * promptAssembler.buildGenerationItem so that sourcing the prompt from the root
 * (when flagged on) is byte-identical to today's isolated construction:
 *   topic               ← ctx.raw.topic → ctx.brief.topic
 *   communicationIntent ← ctx.objective → ctx.raw.objective → ctx.raw.intent.objective
 * `coreMessage` is the richer, brief-derived message used by the visual bridge
 * and persistence (NOT injected into the prompt, so it never causes drift).
 *
 * The returned object is frozen (identity is immutable for the whole request).
 */
export function buildSemanticRoot(ctx: GenerationContext): SemanticRoot {
  const raw = (ctx.raw ?? {}) as Record<string, unknown>;
  const brief = (ctx.brief ?? {}) as Record<string, unknown>;
  const rawIntent = (raw.intent ?? {}) as Record<string, unknown>;

  const topic = trimmed(raw.topic) || briefField(brief, 'topic');

  // The free-form business objective (prompt-facing). Mirrors
  // buildGenerationItem's objective precedence exactly, so the value the prompt
  // consumes under the flag is byte-identical to today. Preserved verbatim in
  // contentBrief.objective (the prompt assembler now sources it from there).
  const rawObjective =
    trimmed(ctx.objective) || trimmed(raw.objective) || trimmed(rawIntent.objective);

  // ICR-1 (TD-13) — the canonical communication intent: the free-form objective
  // mapped onto the platform vocabulary so this producer's grouping id agrees
  // with the A2 coordination layer. Unknown / empty ⇒ 'other' (never fabricated).
  const communicationIntent = normalizeCommunicationIntent(rawObjective);

  const outcomePromise =
    briefField(brief, 'expectedOutcome') || briefField(brief, 'outcome_promise');
  const painPoint =
    briefField(brief, 'whatProblemAreWeAddressing') || briefField(brief, 'pain_point');
  const coreMessage = outcomePromise || painPoint || rawObjective;

  const keyPointsRaw = brief['key_points'];
  const keyPoints = Array.isArray(keyPointsRaw)
    ? keyPointsRaw.map((v) => trimmed(v)).filter(Boolean)
    : undefined;

  const contentBrief: SemanticContentBrief = {
    topic,
    ...(rawObjective ? { objective: rawObjective } : {}),
    ...(trimmed(ctx.audience) ? { audience: trimmed(ctx.audience) } : {}),
    ...(trimmed(ctx.tone) ? { tone: trimmed(ctx.tone) } : {}),
    ...(painPoint ? { painPoint } : {}),
    ...(outcomePromise ? { outcomePromise } : {}),
    ...(keyPoints && keyPoints.length ? { keyPoints } : {}),
    ...(Object.keys(brief).length ? { raw: { ...brief } } : {}),
  };

  const businessGoalId =
    trimmed(raw.businessGoalId) || trimmed(raw.business_goal_id) || undefined;

  // ICR-1 (TD-13) — the DETERMINISTIC grouping key, via the ONE canonical
  // platform derivation. Same (company, canonical intent, campaign, normalized
  // topic) ⇒ same id here (producer) and in A2 (consumer/fallback). Per-run
  // uniqueness moves to generationInstanceId.
  const semanticRootId = deriveSemanticRootId({
    companyId: ctx.companyId,
    communicationIntent,
    campaignId: trimmed(ctx.campaignId) || undefined,
    topic,
  });

  const root: SemanticRoot = {
    semanticRootId,
    generationInstanceId: newGenerationInstanceId(),
    ...(businessGoalId ? { businessGoalId } : {}),
    ...(trimmed(ctx.campaignId) ? { campaignId: trimmed(ctx.campaignId) } : {}),
    topic,
    communicationIntent,
    coreMessage,
    contentBrief,
    createdAt: new Date().toISOString(),
  };

  return Object.freeze(root);
}

/**
 * Derive the lineage/continuity record. `generationLineageRef` is a SOFT ref
 * into the existing `publication_lineage` store — the link, not a new store.
 */
export function buildSemanticContinuity(
  root: SemanticRoot,
  contentId: string | null,
): SemanticContinuity {
  return Object.freeze({
    semanticRootId: root.semanticRootId,
    communicationIntent: root.communicationIntent,
    topic: root.topic,
    ...(root.campaignId ? { campaignId: root.campaignId } : {}),
    contentId,
    generationLineageRef: Object.freeze({
      store: 'publication_lineage' as const,
      contentId,
      semanticRootId: root.semanticRootId,
    }),
  });
}

/**
 * VISUAL BRIDGE (orchestration-only). Derive the Visual Brief from the content
 * brief; the image text is sourced from a HUMAN-READABLE value (objective →
 * core message → topic) so the on-image copy reads naturally. TD-15: it must
 * NOT be `communicationIntent`, which is now a canonical enum token (e.g.
 * `'promote'`) and reads poorly on an image. No image is generated and the
 * image seam is not called.
 */
export function deriveVisualBrief(root: SemanticRoot): VisualBrief {
  const imageText = root.contentBrief.objective || root.coreMessage || root.topic;
  const visualTheme = root.topic || root.coreMessage;
  // WS-1b — the visual brief is DERIVED (not an independent prompt): it inherits
  // the root's communicationIntent + coreMessage and, from the content brief, the
  // human-readable objective / tone / audience. Nothing is re-invented here.
  return Object.freeze({
    semanticRootId: root.semanticRootId,
    derivedFrom: 'content_brief' as const,
    topic: root.topic,
    communicationIntent: root.communicationIntent,
    coreMessage: root.coreMessage,
    imageText,
    visualTheme,
    ...(root.contentBrief.objective ? { objective: root.contentBrief.objective } : {}),
    ...(root.contentBrief.tone ? { tone: root.contentBrief.tone } : {}),
    ...(root.contentBrief.audience ? { audience: root.contentBrief.audience } : {}),
  });
}

/**
 * VISUAL BRIDGE (orchestration-only). Derive the Image Prompt Spec. The prompt
 * CONSUMES the already-generated text (passed in) rather than re-inventing
 * context — preserving continuity end-to-end. Still no image call.
 */
export function deriveImagePromptSpec(
  visualBrief: VisualBrief,
  generatedText: string,
): ImagePromptSpec {
  const grounded = excerpt(generatedText, 600);
  // TD-15 residual fix — narrate a HUMAN-READABLE objective (the free-form
  // business objective → core message → visual theme), NOT the canonical
  // `communicationIntent` enum token (e.g. 'promote'), which reads poorly around
  // an image. The intent still keys continuity via semanticRootId; it is simply
  // not the copy narrated into the image prompt.
  const narratedObjective =
    visualBrief.objective || visualBrief.coreMessage || visualBrief.visualTheme;
  const imagePrompt = [
    `Visual theme: ${visualBrief.visualTheme}.`,
    narratedObjective ? `Objective: ${narratedObjective}.` : '',
    visualBrief.audience ? `Audience: ${visualBrief.audience}.` : '',
    grounded ? `Grounded in the generated copy: ${grounded}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return Object.freeze({
    semanticRootId: visualBrief.semanticRootId,
    derivedFrom: 'generated_text' as const,
    imagePrompt,
    imageText: visualBrief.imageText,
    visualTheme: visualBrief.visualTheme,
  });
}
