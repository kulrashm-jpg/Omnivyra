/**
 * Card-to-Content Bridge — signal layer.
 *
 * Small pure helpers: string utilities, intent/angle derivation, card-signal
 * readers, and the derived-BlogAngle builder. Split from cardToContentBridge.ts
 * (Agent-B large-file modularization). Internal to the bridge modules.
 */

import type { RecommendationStrategicCard } from '../recommendationStrategicCard';
import type { PlannerStrategicCard } from '../plannerStrategicCard';
import type { BlogAngle, AngleType } from '../blog/blogGenerationEngine';
import type { ContentGoal, ThemeCardInput } from './cardToContentBridgeModel';

// ── Internal helpers ───────────────────────────────────────────────────────────

export function str(v: string | null | undefined): string {
  return (v ?? '').trim();
}

export function list(v: string[] | null | undefined): string[] {
  return (v ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0);
}

export function compact(parts: string[], sep = ' | '): string {
  return parts.filter(Boolean).join(sep);
}

/**
 * Derives BlogGenerationRequest.intent from execution_stage or goal.
 * Priority order prevents keyword collisions (e.g. "conversion consideration"
 * must resolve to conversion, not authority via the "consider" substring):
 *   1. conversion  (highest specificity — revenue-stage language)
 *   2. retention   (relationship-stage language)
 *   3. authority   (education / consideration language)
 *   4. awareness   (broad / top-of-funnel language)
 *   5. awareness   (default — least dangerous fallback for unknown stages)
 */
export function deriveIntent(
  executionStage: string | null | undefined,
  goalOverride: ContentGoal | undefined,
): string {
  if (goalOverride) return goalOverride;
  const stage = str(executionStage).toLowerCase();
  if (stage.includes('conversion') || stage.includes('demand') || stage.includes('decision') || stage.includes('capture') || stage.includes('purchase') || stage.includes('close')) return 'conversion';
  if (stage.includes('retention') || stage.includes('relationship') || stage.includes('loyalty') || stage.includes('renewal') || stage.includes('upsell')) return 'retention';
  if (stage.includes('authority') || stage.includes('education') || stage.includes('consider') || stage.includes('evaluation') || stage.includes('thought')) return 'authority';
  if (stage.includes('awareness') || stage.includes('trust') || stage.includes('discovery') || stage.includes('reach')) return 'awareness';
  return 'awareness';
}

/**
 * Derives an AngleType from campaign_angle text.
 * Recommendation card uses a free-text campaign_angle; this maps to the 3 types.
 */
export function deriveAngleType(campaignAngle: string | null | undefined, overrideType?: AngleType): AngleType {
  if (overrideType) return overrideType;
  const a = str(campaignAngle).toLowerCase();
  if (a.includes('contrarian') || a.includes('challenge') || a.includes('myth') || a.includes('wrong')) return 'contrarian';
  if (a.includes('strategic') || a.includes('lever') || a.includes('outcome') || a.includes('decision') || a.includes('roi')) return 'strategic';
  return 'analytical';
}

/**
 * Builds a BlogAngle from the strategic card's intelligence fields.
 * This eliminates the human angle-selection step (GAP creator dependency).
 */
export function buildDerivedAngle(
  card: RecommendationStrategicCard | PlannerStrategicCard,
  type: AngleType,
  themeCard?: ThemeCardInput | null,
): BlogAngle {
  const topic = str(card.core.topic ?? card.core.polished_title);
  const narrative = str(card.core.narrative_direction);

  // Title: use polished_title if available, otherwise compose from angle + topic
  const title = str(card.core.polished_title) ||
    (type === 'contrarian'
      ? `Why Most ${topic} Strategies Miss the Point`
      : type === 'strategic'
      ? `The Strategic Case for ${topic}: What Leaders Get Wrong`
      : `The ${topic} Intelligence Gap: What the Data Reveals`);

  // angle_summary: intelligence fields carry the exact narrative direction
  const intel = card.intelligence;
  const cardAngle = str(intel.campaign_angle);
  const gap = str('gap_being_filled' in intel ? intel.gap_being_filled : null);
  const whyNow = str(intel.why_now);

  const angle_summary = compact([
    cardAngle || narrative,
    whyNow ? `Why now: ${whyNow}` : '',
    gap ? `Gap addressed: ${gap}` : '',
  ], '. ');

  // Hook: use theme card hook if available, otherwise derive from problem
  const themeHook = themeCard?.hooks?.[0] || themeCard?.messaging_hooks?.[0];
  const coreProblem = str(
    'company_context_snapshot' in card
      ? card.company_context_snapshot.core_problem_statement
      : intel.problem_being_solved,
  );
  const hook = themeHook || (coreProblem
    ? `${coreProblem} — and most marketing teams are solving it the wrong way.`
    : `The conventional wisdom about ${topic} is overdue for a serious reexamination.`);

  return {
    type,
    label: type.charAt(0).toUpperCase() + type.slice(1),
    title,
    angle_summary,
    hook,
  };
}

// ── Signal-extraction helpers for depth map ───────────────────────────────────

/** Reads strategy_modifier (numeric) from a RecommendationStrategicCard as a direction label. */
export function readStrategyModifier(card: RecommendationStrategicCard | PlannerStrategicCard): string {
  if (!('signals' in card)) return '';
  const mod = (card as RecommendationStrategicCard).signals.strategy_modifier;
  if (mod === null || mod === undefined) return '';
  // modifier is a numeric score; map ranges to directional labels
  if (mod >= 0.7) return 'challenge the dominant approach';
  if (mod >= 0.4) return 'reframe the conventional model';
  return 'validate and extend current thinking';
}

/** Reads strategy_mode from a RecommendationStrategicCard. */
export function readStrategyMode(card: RecommendationStrategicCard | PlannerStrategicCard): string {
  if (!('signals' in card)) return '';
  return str((card as RecommendationStrategicCard).signals.strategy_mode);
}

/** Reads authority_domains from a RecommendationStrategicCard. */
export function readAuthorityDomains(card: RecommendationStrategicCard | PlannerStrategicCard): string[] {
  if (!('company_context_snapshot' in card)) return [];
  return list((card as RecommendationStrategicCard).company_context_snapshot.authority_domains);
}

/** Reads narrative_flow_seed from a RecommendationStrategicCard. */
export function readNarrativeFlowSeed(card: RecommendationStrategicCard | PlannerStrategicCard): string {
  if (!('company_context_snapshot' in card)) return '';
  return str((card as RecommendationStrategicCard).company_context_snapshot.narrative_flow_seed);
}

/** Reads brand_positioning from a RecommendationStrategicCard. */
export function readBrandPositioning(card: RecommendationStrategicCard | PlannerStrategicCard): string {
  if (!('company_context_snapshot' in card)) return '';
  return str((card as RecommendationStrategicCard).company_context_snapshot.brand_positioning);
}
