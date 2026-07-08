/**
 * Card-to-Content Bridge
 *
 * Eliminates manual re-entry of strategic intelligence when generating content
 * from a Strategic Card or Theme Card. Implements GAP-001 from the system audit.
 *
 * Maps:
 *   RecommendationStrategicCard | PlannerStrategicCard
 *   → BlogGenerationRequest (usable by runBlogGeneration directly)
 *
 * FIELD MAPPING (audit-specified, exact):
 *   campaign_angle          → selected_angle
 *   messaging_hooks[]       → answers.must_include_points
 *   why_now                 → answers.trend_context
 *   gap_being_filled        → answers.uniqueness_directive
 *   problem_being_solved    → answers.company_context (core problem)
 *   desired_transformation  → answers.company_context (transformation goal)
 *   authority_reason        → answers.company_context (authority basis)
 *   audience_personas[]     → answers.audience
 *   pain_symptoms[]         → answers.company_context (pain points)
 *   execution_stage         → intent (mapped to awareness|authority|conversion|retention)
 *   stage_objective         → answers.reader_stage
 *   narrative_direction     → answers.campaign_objective
 *   psychological_goal      → answers.reader_stage (merged with stage_objective)
 *   brand_voice             → tone
 *   reader_emotion_target   → answers.reader_stage
 *   recommended_cta_style   → answers.cta_preference
 *
 * Also injects:
 *   - Depth map per content pillar
 *   - Decision layer (comparisons, trade-offs, when_to_use, when_not_to_use) → GAP-007
 *   - Full structure skeleton with section-level depth requirements
 *   - Hook variants from theme card
 *
 * Exports:
 *   cardToContentBridge(input) → CardBridgeOutput
 *   cardToBlogRequestInput(input) → BlogGenerationRequest-compatible object
 *   VALIDATION_REPORT — post-transformation scoring
 *
 * Module layout (Agent-B large-file modularization — behavior-preserving):
 *   cardToContentBridgeModel.ts    — all public types (re-exported here)
 *   cardToContentBridgeSignals.ts  — string utils + derive/read helpers + derived angle
 *   cardToContentBridgeBuilders.ts — depth map / structure / decision layer / validation
 */

import type { RecommendationStrategicCard } from '../recommendationStrategicCard';
import type { PlannerStrategicCard } from '../plannerStrategicCard';
import type { BlogGenerationRequest } from '../blog/runBlogGeneration';
import type {
  CardBridgeInput,
  CardBridgeOutput,
  ContentGenerationInput,
  ContentGoal,
} from './cardToContentBridgeModel';
import {
  str,
  list,
  compact,
  deriveIntent,
  deriveAngleType,
  buildDerivedAngle,
  readStrategyModifier,
  readStrategyMode,
  readAuthorityDomains,
  readNarrativeFlowSeed,
  readBrandPositioning,
} from './cardToContentBridgeSignals';
import { buildDepthMap, buildStructure, buildDecisionBlocks, buildValidation } from './cardToContentBridgeBuilders';

// Public type surface is unchanged: everything the split moved to the model
// module is re-exported from the original path.
export * from './cardToContentBridgeModel';

// ── Main bridge function ───────────────────────────────────────────────────────

/**
 * cardToContentBridge
 *
 * Maps a strategic card (+ optional theme card) to a complete
 * ContentGenerationInput that runBlogGeneration can consume directly.
 *
 * Zero manual re-entry required. Preserves 100% strategic intelligence.
 */
export function cardToContentBridge(input: CardBridgeInput): CardBridgeOutput {
  const { strategic_card: card, theme_card, content_type = 'blog', target_audience, goal } = input;

  const intel = card.intelligence;
  const exec  = card.execution;

  // ── 1. Derive intent + angle type ─────────────────────────────────────────
  const intent = deriveIntent(exec.execution_stage, goal);
  const angleType = deriveAngleType(intel.campaign_angle, input.override_angle_type);

  // ── 2. Build derived BlogAngle (auto angle selection — fixes creator dependency) ──
  const derived_angle = buildDerivedAngle(card, angleType, theme_card);

  // ── 3. Extract intelligence fields ────────────────────────────────────────
  const isRecCard = 'company_context_snapshot' in card;
  const isPlannerCard = (card as PlannerStrategicCard).schema_type === 'planner_strategic_card';

  const coreProblem = str(
    isRecCard
      ? (card as RecommendationStrategicCard).company_context_snapshot.core_problem_statement ?? intel.problem_being_solved
      : intel.problem_being_solved,
  );
  const painPoints = list(
    isRecCard
      ? (card as RecommendationStrategicCard).company_context_snapshot.pain_symptoms
      : [],
  );
  const transformationGoal = str(
    isRecCard
      ? (card as RecommendationStrategicCard).company_context_snapshot.desired_transformation ?? intel.expected_transformation
      : intel.expected_transformation,
  );
  const authorityBasis = str(
    'authority_reason' in intel
      ? (intel as RecommendationStrategicCard['intelligence']).authority_reason
      : null,
  );
  const gapFilled = str(
    'gap_being_filled' in intel
      ? (intel as RecommendationStrategicCard['intelligence']).gap_being_filled
      : null,
  );
  const whyNow = str(intel.why_now);
  const messagingHooks = list(
    isRecCard
      ? (card as RecommendationStrategicCard).strategic_context.messaging_hooks
      : [],
  );
  const audiencePersonas = list(
    isRecCard
      ? (card as RecommendationStrategicCard).strategic_context.audience_personas
      : (card as PlannerStrategicCard).strategic_context.target_audience,
  );
  const brandVoice = str(
    isRecCard
      ? (card as RecommendationStrategicCard).company_context_snapshot.brand_voice
      : null,
  );
  const ctaStyle = str(
    isRecCard
      ? (card as RecommendationStrategicCard).company_context_snapshot.recommended_cta_style
      : null,
  );
  const readerEmotion = str(
    isRecCard
      ? (card as RecommendationStrategicCard).company_context_snapshot.reader_emotion_target
      : exec.psychological_goal,
  );
  const narrativeDirection = str(card.core.narrative_direction);
  const topic = str(card.core.topic ?? card.core.polished_title);
  const cluster = str(
    isRecCard
      ? (card as RecommendationStrategicCard).strategic_context.aspect
      : null,
  ) || null;

  // ── 3a. Planner card signal fallback derivation ───────────────────────────
  // PlannerStrategicCard lacks gap_being_filled, authority_reason, messaging_hooks,
  // pain_symptoms. Derive each from available Planner-schema fields rather than
  // silently dropping them.
  const plannerCard = isPlannerCard ? (card as PlannerStrategicCard) : null;

  const derivedGapFilled = gapFilled || (
    plannerCard
      ? compact([
          coreProblem ? `${coreProblem} — not adequately solved by existing approaches` : '',
          plannerCard.strategic_context.selected_aspects.length > 0
            ? `Gap in ${plannerCard.strategic_context.selected_aspects.join(', ')} practice`
            : '',
        ])
      : ''
  );

  const derivedAuthorityBasis = authorityBasis || (
    plannerCard
      ? compact([
          plannerCard.strategic_context.campaign_goal ? `Campaign goal authority: ${plannerCard.strategic_context.campaign_goal}` : '',
          plannerCard.strategic_context.key_message ? `Key message positioning: ${plannerCard.strategic_context.key_message}` : '',
          plannerCard.strategic_context.selected_offerings.length > 0 ? `Validated through: ${plannerCard.strategic_context.selected_offerings.join(', ')}` : '',
        ])
      : ''
  );

  const derivedMessagingHooks: string[] = messagingHooks.length > 0
    ? messagingHooks
    : plannerCard
    ? [
        plannerCard.strategic_context.campaign_goal ? plannerCard.strategic_context.campaign_goal : '',
        plannerCard.strategic_context.key_message ? plannerCard.strategic_context.key_message : '',
        str(theme_card?.theme_angle ?? theme_card?.narrative_direction),
      ].filter(Boolean) as string[]
    : [];

  const derivedPainPoints: string[] = painPoints.length > 0
    ? painPoints
    : plannerCard && coreProblem
    ? [
        `${audiencePersonas[0] || 'Target audience'} experiencing: ${coreProblem.slice(0, 80)}`,
        whyNow ? `Urgency factor: ${whyNow.slice(0, 80)}` : '',
        transformationGoal ? `Without the transformation: ${transformationGoal.slice(0, 70)} is out of reach` : '',
      ].filter(Boolean) as string[]
    : [];

  // ── 4. Theme card injection ───────────────────────────────────────────────
  const themeAngle = str(theme_card?.theme_angle ?? theme_card?.narrative_direction);
  // Fall back to derivedMessagingHooks (which already has Planner fallbacks applied)
  const hookVariants = list(theme_card?.hooks ?? theme_card?.messaging_hooks ?? derivedMessagingHooks);
  const tone = str(theme_card?.emotional_tone ?? theme_card?.reader_emotion_target ?? readerEmotion ?? brandVoice);

  // ── 5. Merge must_include_points (hooks + key messages) ───────────────────
  // Use derived hooks (Planner fallback already populated above)
  const mustIncludePoints = Array.from(new Set([
    ...derivedMessagingHooks,
    ...(hookVariants.length > 0 ? hookVariants : []),
  ])).filter(Boolean);

  // ── 6. Build audience string ──────────────────────────────────────────────
  const audience = target_audience?.trim() ||
    audiencePersonas.slice(0, 2).join(', ') ||
    'B2B marketing practitioners and decision-makers';

  // ── 7. Build answers map (auto-populated, fixes creator dependency) ────────
  // Uses derived signals (Planner fallbacks active, sparse card guarantees enforced)
  const answers: Record<string, string> = {};

  // Consume: signals.strategy_mode + signals.strategy_modifier
  const strategyModeSignal = readStrategyMode(card);
  const strategyModifierSignal = readStrategyModifier(card);
  // Consume: brand_positioning, narrative_flow_seed
  const brandPositioningSignal = readBrandPositioning(card);
  const narrativeFlowSeedSignal = readNarrativeFlowSeed(card);
  // Consume: authority_domains
  const authorityDomainsSignal = readAuthorityDomains(card);

  if (audience)             answers.audience           = audience;
  if (whyNow)               answers.trend_context      = whyNow;

  // Use derived gap (Planner fallback)
  if (derivedGapFilled)     answers.uniqueness_directive = derivedGapFilled;

  if (mustIncludePoints.length > 0) {
    answers.must_include_points = mustIncludePoints.join(' | ');
  }

  const contextParts = [
    coreProblem          ? `Core problem: ${coreProblem}` : '',
    transformationGoal   ? `Transformation goal: ${transformationGoal}` : '',
    derivedAuthorityBasis ? `Authority basis: ${derivedAuthorityBasis}` : '',
    derivedPainPoints.length > 0 ? `Pain points: ${derivedPainPoints.join('; ')}` : '',
    authorityDomainsSignal.length > 0 ? `Authority domains: ${authorityDomainsSignal.join(', ')}` : '',
    brandPositioningSignal ? `Brand positioning: ${brandPositioningSignal}` : '',
  ];
  if (contextParts.some(Boolean)) {
    answers.company_context = compact(contextParts);
  }

  if (narrativeDirection || themeAngle || narrativeFlowSeedSignal) {
    answers.campaign_objective = narrativeDirection || themeAngle || narrativeFlowSeedSignal;
  }
  if (exec.stage_objective) {
    answers.reader_stage = compact([str(exec.stage_objective), str(exec.psychological_goal), readerEmotion]);
  }
  if (ctaStyle)   answers.cta_preference = ctaStyle;
  if (brandVoice) answers.writing_style  = brandVoice;

  // Consume: strategy_mode + strategy_modifier into a depth_signal answer key
  if (strategyModeSignal || strategyModifierSignal) {
    answers.depth_signal = compact([
      strategyModeSignal ? `Strategy mode: ${strategyModeSignal}` : '',
      strategyModifierSignal ? `Strategic direction: ${strategyModifierSignal}` : '',
    ]);
  }

  // ── 7a. Sparse card minimum signal set enforcement ────────────────────────
  // If fewer than 5 signals are present, auto-construct minimum set from
  // available fields to prevent clarification loop in runBlogGeneration.
  const signalCount = [whyNow, coreProblem, transformationGoal, derivedGapFilled, derivedAuthorityBasis]
    .filter((s) => s.length > 0).length;

  if (signalCount < 5) {
    // must_include_points minimum 3
    if (!answers.must_include_points || mustIncludePoints.length < 3) {
      const syntheticHooks = [
        intel.campaign_angle ? intel.campaign_angle : `Understanding ${topic} is the first step`,
        whyNow || `The ${topic} landscape has changed — most strategies haven't caught up`,
        transformationGoal || derivedGapFilled || `Closing the ${topic} gap creates compounding advantage`,
      ].filter(Boolean).slice(0, 3);
      answers.must_include_points = syntheticHooks.join(' | ');
    }
    // uniqueness_directive minimum
    if (!answers.uniqueness_directive) {
      answers.uniqueness_directive = derivedGapFilled
        || (intel.campaign_angle ? `Unique angle: ${intel.campaign_angle}` : `${topic} — differentiated perspective on ${whyNow || 'the current challenge'}`);
    }
    // trend_context minimum
    if (!answers.trend_context) {
      answers.trend_context = whyNow
        || (intel.campaign_angle ? `Context: ${intel.campaign_angle}` : `${topic} is evolving — teams that don't adapt will fall behind`);
    }
  }

  // ── 8. Build depth map ────────────────────────────────────────────────────
  const depth_map = buildDepthMap(card);

  // ── 9. Build structure ────────────────────────────────────────────────────
  const structure = buildStructure(depth_map, mustIncludePoints, intent);

  // ── 10. Build decision layer (GAP-007) ────────────────────────────────────
  const decision_blocks = buildDecisionBlocks(card);

  // ── 11. Key messages (board-level) ────────────────────────────────────────
  const keyMessages = Array.from(new Set([
    intel.campaign_angle,
    derivedGapFilled,
    whyNow,
    transformationGoal,
    str(card.blueprint?.progression_summary),
  ].filter(Boolean))) as string[];

  // ── 12. Differentiation signal ────────────────────────────────────────────
  // Consume: brand_positioning signal
  const differentiation = compact([
    derivedGapFilled ? `Gap filled: ${derivedGapFilled}` : '',
    derivedAuthorityBasis ? `Authority: ${derivedAuthorityBasis}` : '',
    transformationGoal ? `Outcome: ${transformationGoal}` : '',
    readBrandPositioning(card) ? `Positioning: ${readBrandPositioning(card)}` : '',
  ]);

  // ── Assemble output ───────────────────────────────────────────────────────
  const content_generation_input: ContentGenerationInput = {
    content_type,
    audience,
    goal: goal ?? (intent as ContentGoal),
    selected_angle: intel.campaign_angle || derived_angle.angle_summary,
    strategic_core: {
      core_problem: coreProblem,
      pain_points: derivedPainPoints,
      transformation_goal: transformationGoal,
      authority_basis: derivedAuthorityBasis,
    },
    narrative_direction: themeAngle || narrativeDirection,
    must_include_points: mustIncludePoints,
    trend_context: answers.trend_context || whyNow,
    uniqueness_directive: derivedGapFilled,
    depth_map,
    structure,
    decision_blocks,
    tone,
    hook_variants: hookVariants.length > 0 ? hookVariants : [derived_angle.hook],
    differentiation,
    key_messages: keyMessages,
    answers,
    derived_angle,
    intent,
    topic,
    cluster,
  };

  return {
    content_generation_input,
    validation: buildValidation(content_generation_input, Boolean(theme_card)),
  };
}

/**
 * cardToBlogRequest
 *
 * Converts a CardBridgeOutput directly to a BlogGenerationRequest shape.
 * Pass the result to runBlogGeneration() with no additional mapping.
 *
 * @param bridgeOutput  - output from cardToContentBridge()
 * @param companyId     - required by BlogGenerationRequest for auth + DB scope
 * @param mode          - 'angles' to generate angle options, 'full' to generate immediately (default: 'full')
 */
export function cardToBlogRequest(
  bridgeOutput: CardBridgeOutput,
  companyId: string,
  mode: 'angles' | 'full' = 'full',
): BlogGenerationRequest {
  const cgi = bridgeOutput.content_generation_input;

  return {
    company_id: companyId,
    mode,
    topic: cgi.topic || 'Strategic content',
    cluster: cgi.cluster ?? undefined,
    intent: cgi.intent,
    answers: cgi.answers,
    selected_angle: cgi.derived_angle ?? undefined,
    tone: cgi.tone || undefined,
    blogTable: 'blogs',
  };
}
