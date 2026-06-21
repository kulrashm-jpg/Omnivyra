/**
 * PHASE CREATOR-BRIEF-UNIVERSAL-COVERAGE — read-authority synthesis.
 *
 * Single convergence point for the Activity Workspace / Creator Workspace /
 * Production Guide brief. Applied ONLY at read time (resolve.ts) and ONLY for
 * creator rows: it gap-fills an empty creator brief so no creator row renders
 * "-", regardless of how the row was created (deterministic generation,
 * creator-asset insert, upload workflow, raw-AI save, manual commit, or a
 * historical pre-parity row).
 *
 * Reuses ONLY the existing synth authorities (deriveSynthPainPoint /
 * deriveSynthOutcomePromise). No new enrichment engine, no AI call, no prompt
 * chain. Read-time only — nothing is persisted, so generation/scheduler/
 * publisher/upload/DB are untouched.
 *
 * Fallback priority for every field (never overwrites a populated value):
 *   1. existing row value (raw daily-plan fields)
 *   2. existing creator_card value
 *   3. existing intent value
 *   4. synthesized fallback (topic-derived / deriveSynth* helpers)
 */
import {
  deriveSynthPainPoint,
  deriveSynthOutcomePromise,
} from '../../pages/api/campaigns/weekly-structure-helpers';

/** Creator content types (mirrors buildCreatorCard's requiresMediaBrief set). */
const CREATOR_FORMATS = new Set([
  'video', 'reel', 'reels', 'short', 'shorts', 'image', 'carousel', 'infographic',
  'story', 'stories', 'podcast', 'banner', 'pdf', 'slider', 'deck', 'presentation',
]);

export function isCreatorContentType(contentType: unknown): boolean {
  return CREATOR_FORMATS.has(String(contentType ?? '').trim().toLowerCase());
}

/** Trimmed string, or '' for any non-string / blank. */
function nz(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

export interface SynthesizeCreatorBriefInput {
  /** Existing creator_card from the row (may be null / partial). */
  existingCard?: Record<string, any> | null;
  /** The raw daily-plan item (carries dailyObjective / whoAreWeWritingFor / etc.). */
  rawItem?: Record<string, any> | null;
  /** The assembled intent object (dailyExecutionItem.intent), may be partial. */
  intent?: Record<string, any> | null;
  /** Row topic / title. */
  topic: string;
  /** Row content type (for outcome-promise shaping). */
  contentType: string;
}

export interface SynthesizedCreatorBrief {
  creator_card: Record<string, unknown>;
  intent: Record<string, unknown>;
}

/**
 * Gap-fill a creator brief. Returns a merged `creator_card` (with a fully
 * populated `intent` block) and a merged top-level `intent`. Every existing
 * value is preserved; only empty fields are filled.
 */
export function synthesizeCreatorBrief(input: SynthesizeCreatorBriefInput): SynthesizedCreatorBrief {
  const card = input.existingCard && typeof input.existingCard === 'object' ? { ...input.existingCard } : {};
  const cardIntent = card.intent && typeof card.intent === 'object' && !Array.isArray(card.intent)
    ? { ...(card.intent as Record<string, any>) }
    : {};
  const intent = input.intent && typeof input.intent === 'object' && !Array.isArray(input.intent)
    ? { ...input.intent }
    : {};
  const raw = input.rawItem && typeof input.rawItem === 'object' ? input.rawItem : {};
  const topic = nz(input.topic) || 'this topic';
  const ct = nz(input.contentType).toLowerCase();

  // Field-level fallback chains: row → creator_card → intent → synthesized.
  const objective =
    nz(raw.dailyObjective) || nz(raw.objective) || nz(card.objective) || nz(cardIntent.objective) || nz(intent.objective)
    || `Build awareness and engagement around ${topic}.`;
  const target_audience =
    nz(raw.whoAreWeWritingFor) || nz(card.target_audience) || nz(cardIntent.target_audience) || nz(intent.target_audience)
    || 'Target audience from campaign context';
  const brief_summary =
    nz(raw.briefSummary) || nz(card.summary) || nz(cardIntent.brief_summary) || nz(intent.brief_summary) || nz(raw.writingIntent)
    || `Address "${topic}" for the target audience.`;
  const pain_point =
    nz(raw.whatProblemAreWeAddressing) || nz(cardIntent.pain_point) || nz(intent.pain_point) || nz(raw.summary)
    || deriveSynthPainPoint(topic);
  const outcome_promise =
    nz(raw.whatShouldReaderLearn) || nz(cardIntent.outcome_promise) || nz(intent.outcome_promise)
    || deriveSynthOutcomePromise(topic, ct);
  const cta_type =
    nz(raw.desiredAction) || nz(cardIntent.cta_type) || nz(intent.cta_type) || nz(raw.cta) || 'Soft CTA';
  const narrative_style =
    nz(raw.narrativeStyle) || nz(cardIntent.narrative_style) || nz(intent.narrative_style) || 'clear, practical, outcome-driven';

  // The locals above already encode the row > card > intent > synth priority,
  // so the merged shapes use them directly (spreading the originals only to
  // preserve any EXTRA fields — e.g. keywords, strategic_role — untouched).
  const briefFields = {
    objective,
    target_audience,
    brief_summary,
    pain_point,
    outcome_promise,
    cta_type,
    narrative_style,
  };

  const mergedIntent: Record<string, unknown> = { ...intent, ...briefFields };

  const mergedCardIntent: Record<string, unknown> = {
    ...cardIntent,
    ...briefFields,
    strategic_role: cardIntent.strategic_role ?? '',
  };

  const creator_card: Record<string, unknown> = {
    ...card,
    objective,
    target_audience,
    summary: brief_summary,
    intent: mergedCardIntent,
  };

  return { creator_card, intent: mergedIntent };
}
