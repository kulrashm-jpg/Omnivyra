/**
 * EC-R2 — Campaign Content Uniqueness Enforcement.
 *
 * THE seam that stops a campaign from publishing the same post twice. It does
 * NOT implement similarity: every comparison is delegated to the existing
 * `originalityGate` (7 stages, threshold 0.82) over the existing
 * `contentMemoryService`. This module only supplies the two things the campaign
 * path was missing — a campaign-scoped MEMORY and an ACCEPTANCE boundary.
 *
 * WHY THIS EXISTS
 * ---------------
 * The BOLT campaign path generated every content item in isolation:
 *
 *   • it never called the originality gate (the live block-processor path had no
 *     originality machinery at all; the superseded two-phase path reached the
 *     canonical runtime only behind a default-OFF flag, and even then passed
 *     `runOriginality:false`), and
 *   • it never indexed its accepted output, because it calls the runtime with
 *     `persist:false`, which skips the `indexContentUnit` trio entirely.
 *
 * Both halves matter. Enabling the gate WITHOUT indexing would have been a
 * silent no-op: `retrieveRelevant` would return zero campaign rows, the gate
 * would take its `candidates.length === 0` early exit and return
 * `decision:'accepted'` for literally every candidate. That reads like success
 * in every log and metric while changing nothing. So this module writes to
 * memory on acceptance and reads from it on the next candidate.
 *
 * SCOPE
 * -----
 * Comparison is scoped to (company_id, campaign_id) — `retrieveRelevant` filters
 * on company first (tenant isolation is structural, and RLS backs it), then on
 * campaign. Week N is therefore compared against weeks 1…N-1 of the SAME
 * campaign and nothing else.
 *
 * FAIL-OPEN vs FAIL-CLOSED
 * ------------------------
 * Deliberately mixed, matching the existing engine's contract:
 *   • originality INFRASTRUCTURE failures are fail-OPEN (gate returns
 *     'bypassed'; memory writes are fail-safe) — checking must never break
 *     generation, and `regenerateUntilOriginal` already guarantees this.
 *   • a CONFIRMED duplicate that survives bounded regeneration is fail-CLOSED —
 *     it throws, because silently persisting a duplicate is the exact defect
 *     this phase exists to remove.
 *
 * The cache is intentionally untouched. It is correct: identical normalized
 * prompts SHOULD return identical completions. The defect was degenerate inputs
 * producing identical prompts, and no acceptance gate to catch the result.
 */

import { assertOriginality } from './originalityGate';
import { regenerateUntilOriginal } from './originalityRegeneration';
import {
  indexContentUnit,
  persistOriginality,
  retrieveRelevant,
} from './contentMemoryService';
import type { OriginalityResult } from '../../../lib/content/originality/types';

/**
 * The generic fallback constants used by BOTH `buildItemFromEnriched`
 * implementations (boltScheduleBlockProcessor + boltContentGenerationForSchedule).
 *
 * These are NOT removed. They are legitimate for a brief that carries real
 * signal in its other fields — a missing CTA should not fail a well-specified
 * item. They become a defect only when the brief carries NOTHING else, because
 * then every week produces a byte-identical prompt.
 */
export const DEGENERATE_BRIEF_DEFAULTS = {
  objective: 'Educate and engage the audience',
  painPoint: 'Audience challenge relevant to topic',
  outcomePromise: 'Clear value from this content',
  ctaType: 'Soft engagement',
  targetAudience: 'Professional audience',
} as const;

/** Topic placeholders that carry no campaign-specific signal. */
const PLACEHOLDER_TOPICS = new Set(['', 'tbd', 'untitled', 'untitled topic', 'topic']);

/** A brief so generic it cannot produce campaign-specific content. */
export class CampaignBriefDegenerateError extends Error {
  readonly code = 'CAMPAIGN_BRIEF_DEGENERATE';
  constructor(message: string) {
    super(message);
    this.name = 'CampaignBriefDegenerateError';
  }
}

/** A candidate that stayed a (near-)duplicate after bounded regeneration. */
export class CampaignDuplicateContentError extends Error {
  readonly code = 'CAMPAIGN_CONTENT_DUPLICATE';
  readonly originality: OriginalityResult;
  constructor(message: string, originality: OriginalityResult) {
    super(message);
    this.name = 'CampaignDuplicateContentError';
    this.originality = originality;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** True when `value` is empty or exactly the known generic fallback. */
function isGenericOrEmpty(value: unknown, fallback: string): boolean {
  const v = text(value);
  return v === '' || v === fallback;
}

/**
 * Fail loudly when a generation brief has collapsed to nothing but defaults.
 *
 * The rule is deliberately CONSERVATIVE — it fires only when the brief has no
 * usable signal anywhere:
 *
 *   every one of the five intent fields is empty/generic
 *   AND the topic is empty or a placeholder
 *   AND the writer brief contributes no non-empty field
 *
 * A brief with a real topic, or any one real intent field, still generates. That
 * keeps existing valid behaviour intact while removing the only shape that
 * GUARANTEES cross-week duplicates.
 */
export function assertBriefNotDegenerate(
  item: Record<string, unknown>,
  context?: { campaignId?: string | null; weekNumber?: number | null },
): void {
  const intent = (item.intent ?? {}) as Record<string, unknown>;
  const brief = (item.writer_content_brief ?? {}) as Record<string, unknown>;

  const allIntentGeneric =
    isGenericOrEmpty(intent.objective, DEGENERATE_BRIEF_DEFAULTS.objective) &&
    isGenericOrEmpty(intent.pain_point, DEGENERATE_BRIEF_DEFAULTS.painPoint) &&
    isGenericOrEmpty(intent.outcome_promise, DEGENERATE_BRIEF_DEFAULTS.outcomePromise) &&
    isGenericOrEmpty(intent.cta_type, DEGENERATE_BRIEF_DEFAULTS.ctaType) &&
    isGenericOrEmpty(intent.target_audience, DEGENERATE_BRIEF_DEFAULTS.targetAudience);

  if (!allIntentGeneric) return;

  const topic = text(item.topic) || text(item.title);
  if (!PLACEHOLDER_TOPICS.has(topic.toLowerCase())) return;

  // Last chance: does the writer brief carry anything real?
  const briefSignal = [
    brief.writingIntent,
    brief.whatShouldReaderLearn,
    brief.whatProblemAreWeAddressing,
    brief.desiredAction,
    brief.topicGoal,
  ].some((v) => text(v).length > 0);
  if (briefSignal) return;

  const where = [
    context?.campaignId ? `campaign ${context.campaignId}` : null,
    context?.weekNumber != null ? `week ${context.weekNumber}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  throw new CampaignBriefDegenerateError(
    `Generation brief carries no campaign-specific signal${where ? ` (${where})` : ''}: ` +
      'topic is a placeholder and every intent field is empty or the generic default. ' +
      'Generating from this brief would produce an identical prompt — and therefore ' +
      'identical content — for every week. Re-run weekly enrichment so the item has a ' +
      'real topic, objective, pain point, outcome promise, CTA or audience before generating.',
  );
}

/** How much already-used campaign material to feed back into the prompt. */
const NEGATIVE_CONTEXT_MEMORY_LIMIT = 25;
const NEGATIVE_CONTEXT_MAX_ITEMS = 8;

function collectUnique(values: unknown, sink: Set<string>, max: number): void {
  if (!Array.isArray(values)) return;
  for (const raw of values) {
    if (sink.size >= max) return;
    const v = text(raw);
    if (v) sink.add(v.length > 120 ? `${v.slice(0, 117)}…` : v);
  }
}

/**
 * Build a compact "already used in this campaign" block from EXISTING campaign
 * memory. No new store: `content_memory.intelligence` was designed to carry
 * `{hooks, ctas, narratives, keyMessages}` for exactly this purpose, and
 * `text_excerpt` supplies short titles.
 *
 * Deliberately small and capped — this is a differentiation hint, not a dump of
 * campaign history into every prompt (that would inflate cost and dilute the
 * brief). Returns null when there is nothing to say.
 */
export async function buildCampaignNegativeContext(params: {
  companyId: string;
  campaignId: string;
  contentType?: string;
}): Promise<string | null> {
  if (!params.companyId || !params.campaignId) return null;

  let records;
  try {
    records = await retrieveRelevant(params.companyId, {
      campaignId: params.campaignId,
      ...(params.contentType ? { contentType: params.contentType } : {}),
      limit: NEGATIVE_CONTEXT_MEMORY_LIMIT,
    });
  } catch {
    return null; // fail-safe: never block generation on a memory read
  }
  if (!Array.isArray(records) || records.length === 0) return null;

  const excerpts = new Set<string>();
  const hooks = new Set<string>();
  const ctas = new Set<string>();
  const narratives = new Set<string>();

  for (const rec of records) {
    const excerpt = text(rec?.textExcerpt);
    if (excerpt && excerpts.size < NEGATIVE_CONTEXT_MAX_ITEMS) {
      excerpts.add(excerpt.length > 120 ? `${excerpt.slice(0, 117)}…` : excerpt);
    }
    const intel = rec?.intelligence as Record<string, unknown> | null | undefined;
    if (intel) {
      collectUnique(intel.hooks, hooks, NEGATIVE_CONTEXT_MAX_ITEMS);
      collectUnique(intel.ctas, ctas, NEGATIVE_CONTEXT_MAX_ITEMS);
      collectUnique(intel.narratives, narratives, NEGATIVE_CONTEXT_MAX_ITEMS);
    }
  }

  const sections: string[] = [];
  if (excerpts.size) sections.push(`Already published in this campaign:\n- ${[...excerpts].join('\n- ')}`);
  if (hooks.size) sections.push(`Hooks already used: ${[...hooks].join(' | ')}`);
  if (ctas.size) sections.push(`CTAs already used: ${[...ctas].join(' | ')}`);
  if (narratives.size) sections.push(`Angles already covered: ${[...narratives].join(' | ')}`);
  if (sections.length === 0) return null;

  return (
    'CAMPAIGN UNIQUENESS — this piece must NOT repeat the material below. ' +
    'Keep the campaign\'s strategic through-line, but take a distinct angle, hook and example.\n' +
    sections.join('\n')
  );
}

export interface UniqueMasterInput<T> {
  companyId: string | null;
  campaignId: string | null;
  contentType: string;
  platform?: string | null;
  /** 1-based attempt; MUST perform a fresh generation each call. */
  generate: (attempt: number) => Promise<{ text: string; result: T }>;
  /** Defaults to the engine's own bounded policy (no new retry policy here). */
  maxAttempts?: number;
  /** Lifecycle recorded on the indexed memory unit. */
  lifecycleStatus?: string;
  /** Diagnostics only. */
  weekNumber?: number | null;
  /**
   * B4.1 — OPTIONAL canonical-artifact hook, invoked exactly once with the
   * ACCEPTED text, immediately before the memory unit is indexed. Its return
   * value becomes `content_memory.content_id`, which is `null` today because
   * this path had no canonical artifact to point at.
   *
   * Deliberately a callback rather than a direct createContent call: this
   * module owns UNIQUENESS, not persistence, and must not acquire a dependency
   * on the canonical content service or its policy flag. Omitted ⇒ contentId
   * stays null and behaviour is identical to before. Fail-safe: a throw or a
   * null return degrades to null, never to a failed generation.
   */
  persistAccepted?: (acceptedText: string) => Promise<string | null>;
}

export interface UniqueMasterOutcome<T> {
  text: string;
  result: T;
  originality: OriginalityResult;
  attempts: number;
  regenerated: boolean;
  /** True when the accepted output was written to campaign memory. */
  indexed: boolean;
  /**
   * B4.1 — id of the canonical artifact minted for the accepted text, or null
   * when no `persistAccepted` hook was supplied (or it declined/failed).
   */
  contentId: string | null;
}

/**
 * Generate a campaign master, enforce originality against THIS campaign's prior
 * accepted content, persist the verdict, and index the accepted output so the
 * next week can be compared against it.
 *
 * Throws `CampaignDuplicateContentError` when a confirmed duplicate survives the
 * existing bounded regeneration policy — the caller must treat that as a
 * generation failure, NOT persist the text.
 */
export async function generateUniqueCampaignMaster<T>(
  input: UniqueMasterInput<T>,
): Promise<UniqueMasterOutcome<T>> {
  const { companyId, campaignId, contentType } = input;
  const platform = input.platform ?? null;

  // Without a tenant we cannot scope memory at all. Generating unchecked is the
  // correct fail-open: this module must never invent a cross-tenant comparison.
  if (!companyId || !campaignId) {
    const gen = await input.generate(1);
    return {
      text: gen.text,
      result: gen.result,
      originality: {
        isOriginal: true,
        score: 1,
        decision: 'bypassed',
        nearestMatches: [],
        dimensions: {},
        fingerprint: { exactHash: '', normalizedHash: '', simhash: '', minhash: [], structuralShape: '', tokenSummary: { tokens: [], shingles: [] } },
      } as unknown as OriginalityResult,
      attempts: 1,
      regenerated: false,
      indexed: false,
      // B4.1 — no tenant ⇒ no campaign scope ⇒ no canonical artifact. The hook
      // is deliberately NOT invoked here: content.company_id is NOT NULL and
      // content.campaign_id would be meaningless without both.
      contentId: null,
    };
  }

  const outcome = await regenerateUntilOriginal<T>({
    generate: input.generate,
    assert: (candidate: string) =>
      assertOriginality({
        companyId,
        campaignId,
        contentType,
        platform,
        candidateText: candidate,
      }),
    ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
  });

  // Record the verdict either way — a rejection is exactly the signal the
  // campaign-quality surface needs. Fail-safe by contract (returns null).
  try {
    await persistOriginality({
      companyId,
      contentId: null,
      originalityScore: outcome.originality.score,
      decision: outcome.originality.decision,
      nearestMatches: outcome.originality.nearestMatches,
      similarityDimensions: outcome.originality.dimensions,
      regenerationCount: Math.max(0, outcome.attempts - 1),
      generationFingerprint: outcome.originality.fingerprint?.exactHash ?? '',
    });
  } catch {
    /* fail-safe: diagnostics must never break generation */
  }

  if (!outcome.originality.isOriginal) {
    const nearest = outcome.originality.nearestMatches?.[0];
    throw new CampaignDuplicateContentError(
      `Generated content duplicates existing campaign content after ${outcome.attempts} attempt(s) ` +
        `(originality ${outcome.originality.score.toFixed(2)}` +
        `${nearest?.dimension ? `, matched on ${nearest.dimension}` : ''}` +
        `${nearest?.excerpt ? `: "${nearest.excerpt.slice(0, 80)}"` : ''}). ` +
        'Not persisted. Differentiate the week\'s topic, angle or objective and regenerate.',
      outcome.originality,
    );
  }

  // Accepted → remember it, so the NEXT week is compared against this piece.
  // Indexed as a committed lifecycle so the gate's default retrieval filter
  // (published/approved/scheduled, or any platform variant) actually sees it —
  // indexing a master as 'draft' with platform=null would be invisible.
  //
  // B4.1 — mint the canonical artifact first (when a hook is supplied) so the
  // memory unit can carry a real content_id instead of null. Runs ONLY after
  // acceptance: rejected/duplicate text never produces a content row.
  let contentId: string | null = null;
  if (input.persistAccepted) {
    try {
      contentId = (await input.persistAccepted(outcome.text)) ?? null;
    } catch {
      /* fail-safe: the artifact is additive; generation must never fail on it */
    }
  }

  let indexed = false;
  try {
    const memory = await indexContentUnit({
      companyId,
      contentId,
      campaignId,
      contentType,
      platform,
      lifecycleStatus: input.lifecycleStatus ?? 'scheduled',
      text: outcome.text,
    });
    indexed = Boolean(memory);
  } catch {
    /* fail-safe */
  }

  return {
    text: outcome.text,
    result: outcome.result,
    originality: outcome.originality,
    attempts: outcome.attempts,
    regenerated: outcome.regenerated,
    indexed,
    contentId,
  };
}
